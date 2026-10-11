import ExcelJS from "exceljs";
import { validateWorkbookArchive } from "./xlsx-safety.js";
import { fail, recalculateTier, type DB } from "./workflow.js";
export const archiveProjects = [
  "Aeluri Formula",
  "뷰티비티",
  "두유본색",
  "로레코",
];
export function historicalActivities(db: DB, user: number) {
  return (
    db
      .prepare(
        "SELECT project_key AS title,content_links,submitted_at FROM historical_activities WHERE user_id=? ORDER BY project_key",
      )
      .all(user) as any[]
  ).map((r) => ({ ...r, links: JSON.parse(r.content_links) }));
}
export async function readActivityWorkbook(buffer: Buffer) {
  validateWorkbookArchive(buffer);
  const book = new ExcelJS.Workbook();
  try {
    await book.xlsx.load(buffer as any);
  } catch {
    fail("엑셀 파일을 읽을 수 없습니다.");
  }
  const groups = new Map<
    string,
    { project: string; email: string; links: Set<string>; submitted: string }
  >();
  const issues: { sheet: string; row: number; reason: string }[] = [];
  let rows = 0;
  for (const project of archiveProjects) {
    const sheet =
      book.getWorksheet(project) ||
      fail("4개 프로젝트 시트를 모두 포함한 원본 엑셀을 선택해 주세요.");
    if (sheet.rowCount > 1001 || sheet.columnCount > 30)
      fail("프로젝트 시트 크기가 너무 큽니다.");
    const headers = new Map<string, number>();
    sheet
      .getRow(1)
      .eachCell((c, i) => headers.set(String(c.text ?? "").trim(), i));
    const emailCol = headers.get("이메일"),
      linkCol = headers.get("올린 링크"),
      dateCol = headers.get("제출일시");
    if (!emailCol || !linkCol)
      fail("이메일 또는 올린 링크 열을 찾을 수 없습니다.");
    for (let row = 2; row <= sheet.rowCount; row++) {
      const text = (col: number | undefined) =>
        col ? String(sheet.getRow(row).getCell(col).text ?? "").trim() : "";
      const email = text(emailCol).toLowerCase(),
        raw = text(linkCol);
      if (!email && !raw) continue;
      rows++;
      if (
        email.length > 254 ||
        !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(email)
      ) {
        issues.push({ sheet: project, row, reason: "이메일 형식 오류" });
        continue;
      }
      const links = [];
      for (const match of raw.matchAll(/https?:\/\/[^\s<>"']+/g)) {
        try {
          const url = new URL(match[0]);
          if (
            ["http:", "https:"].includes(url.protocol) &&
            !url.username &&
            !url.password &&
            url.href.length <= 2000
          )
            links.push(url.href);
        } catch {}
      }
      if (!links.length) {
        issues.push({ sheet: project, row, reason: "유효한 콘텐츠 링크 없음" });
        continue;
      }
      const key = project + ":" + email;
      if (!groups.has(key))
        groups.set(key, {
          project,
          email,
          links: new Set(),
          submitted: text(dateCol).slice(0, 120),
        });
      for (const link of links) groups.get(key)!.links.add(link);
    }
  }
  return { groups: [...groups.values()], issues, rows };
}
export async function importActivities(
  db: DB,
  buffer: Buffer,
  dryRun = true,
  actor?: number,
) {
  const parsed = await readActivityWorkbook(buffer);
  const matched: ((typeof parsed.groups)[number] & { user: number })[] = [];
  const unmatched: { project: string; email: string }[] = [];
  for (const group of parsed.groups) {
    const user = db
      .prepare("SELECT id FROM users WHERE email=? AND role='influencer'")
      .get(group.email) as any;
    if (!user) {
      unmatched.push({ project: group.project, email: group.email });
      continue;
    }
    matched.push({ ...group, user: user.id });
  }
  const ready = matched.filter(
    (g) =>
      !db
        .prepare(
          "SELECT id FROM historical_activities WHERE user_id=? AND project_key=?",
        )
        .get(g.user, g.project),
  ).length;
  const summary = {
    projects: archiveProjects,
    source_rows: parsed.rows,
    participations: parsed.groups.length,
    ready,
    existing: matched.length - ready,
    unmatched,
    issues: parsed.issues,
  };
  if (dryRun) return { ...summary, imported: 0 };
  return db.transaction(() => {
    let imported = 0;
    const affected = new Set<number>();
    for (const g of matched) {
      const old = db
        .prepare(
          "SELECT * FROM historical_activities WHERE user_id=? AND project_key=?",
        )
        .get(g.user, g.project) as any;
      const links = [
        ...new Set<string>([
          ...(old ? JSON.parse(old.content_links) : []),
          ...g.links,
        ]),
      ];
      if (old)
        db.prepare(
          "UPDATE historical_activities SET content_links=? WHERE id=?",
        ).run(JSON.stringify(links), old.id);
      else {
        db.prepare(
          "INSERT INTO historical_activities(user_id,project_key,content_links,submitted_at,imported_at) VALUES(?,?,?,?,?)",
        ).run(
          g.user,
          g.project,
          JSON.stringify(links),
          g.submitted,
          Date.now(),
        );
        db.prepare(
          "UPDATE influencer_profiles SET completed_count=completed_count+1 WHERE user_id=?",
        ).run(g.user);
        imported++;
      }
      affected.add(g.user);
    }
    for (const user of affected) recalculateTier(db, user);
    if (actor)
      db.prepare(
        "INSERT INTO admin_audit(actor_id,action,note,created_at) VALUES(?,?,?,?)",
      ).run(
        actor,
        "activity_import",
        JSON.stringify({ imported, unmatched: unmatched.length }),
        Date.now(),
      );
    return { ...summary, imported };
  })();
}
