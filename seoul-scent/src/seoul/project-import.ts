import ExcelJS from "exceljs";
import { hashPassword } from "./db.js";
import { validateWorkbookArchive } from "./xlsx-safety.js";
import { socialProfileUrl } from "./profile.js";
import { type DB, fail } from "./workflow.js";

export const secondProjectBrands = [
  {
    username: "varihope",
    name: "배리홉",
    sheet: "배리홉(Varihope)",
    product: "미백앰플 + 미백마스크팩 (5매입)",
  },
  {
    username: "airmood",
    name: "에어무드",
    sheet: "에어무드(Airmood)",
    product: "수분크림 + 선크림 세트",
  },
  {
    username: "teriv",
    name: "테리브",
    sheet: "테리브(Teriv)",
    product: "데일리 밸런스 듀오 (폼클렌징 1+1)",
  },
  {
    username: "livhamo",
    name: "리브하모",
    sheet: "리브하모(Livhamo)",
    product: "투웨이 백팩",
  },
];
const agrees = (v: string) => v.trim() === "동의합니다 / I agree";
export async function readSecondProject(buffer: Buffer) {
  validateWorkbookArchive(buffer);
  const book = new ExcelJS.Workbook();
  try {
    await book.xlsx.load(buffer as any);
  } catch {
    fail("엑셀 파일을 읽을 수 없습니다.");
  }
  const people = new Map<
    string,
    { name: string; email: string; phone: string; social: string }
  >();
  const applications: {
    username: string;
    email: string;
    address: string;
    secondary: boolean;
    submitted: string;
  }[] = [];
  const issues: { sheet: string; row: number; reason: string }[] = [];
  for (const brand of secondProjectBrands) {
    const sheet =
      book.getWorksheet(brand.sheet) ||
      fail("2차 프로젝트의 4개 브랜드 시트를 확인해 주세요.");
    if (!sheet || sheet.rowCount > 501 || sheet.columnCount !== 12)
      fail("2차 프로젝트의 4개 브랜드 시트를 확인해 주세요.");
    if (
      !sheet.getRow(1).getCell(4).text.includes("이메일") ||
      !sheet.getRow(1).getCell(11).text.includes("2차 활용")
    )
      fail("신청서 열 구성이 올바르지 않습니다.");
    const seen = new Set<string>();
    for (let row = 2; row <= sheet.rowCount; row++) {
      const value = (col: number) => sheet.getRow(row).getCell(col).text.trim();
      const email = value(4).toLowerCase(),
        name = value(2);
      if (!email && !name) continue;
      if (
        !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(email) ||
        email.length > 254 ||
        name.length < 2 ||
        name.length > 60
      ) {
        issues.push({
          sheet: brand.sheet,
          row,
          reason: "이름 또는 이메일 형식 오류",
        });
        continue;
      }
      if (seen.has(email)) {
        issues.push({
          sheet: brand.sheet,
          row,
          reason: "브랜드 시트 내 중복 이메일",
        });
        continue;
      }
      if (!agrees(value(10)) || !agrees(value(12))) {
        issues.push({
          sheet: brand.sheet,
          row,
          reason: "활동 또는 개인정보 동의 확인 필요",
        });
        continue;
      }
      if (!value(9).includes(`[${brand.name}]`)) {
        issues.push({
          sheet: brand.sheet,
          row,
          reason: "브랜드 지원 선택 불일치",
        });
        continue;
      }
      let phone = value(3).replace(/^(?:\+82|0082)[ -]?0?/, "0");
      if (/^10\d{8}$/.test(phone)) phone = "0" + phone;
      if (!/^[+0-9 ()-]{8,30}$/.test(phone)) phone = "";
      let social = value(6);
      if (!/^https:\/\//.test(social))
        social = "https://" + social.replace(/^http:\/\//, "");
      if (!socialProfileUrl(social)) social = "";
      seen.add(email);
      if (!people.has(email)) people.set(email, { name, email, phone, social });
      applications.push({
        username: brand.username,
        email,
        address: value(5).slice(0, 500),
        secondary: agrees(value(11)),
        submitted: value(1).slice(0, 120),
      });
    }
  }
  return { people: [...people.values()], applications, issues };
}
export async function importSecondProject(
  db: DB,
  buffer: Buffer,
  actor: number,
  dryRun = true,
  skipInvalid = false,
) {
  const parsed = await readSecondProject(buffer);
  if (
    parsed.issues.length &&
    !(
      skipInvalid &&
      parsed.issues.every((i) => i.reason === "이름 또는 이메일 형식 오류")
    )
  )
    fail("신청서 검토 오류가 있습니다. 원본을 확인해 주세요.");
  for (const brand of secondProjectBrands) {
    const existing = db
      .prepare("SELECT * FROM users WHERE username=? OR email=?")
      .get(brand.username, brand.username) as any;
    if (
      existing &&
      (existing.role !== "brand" || existing.username !== brand.username)
    )
      fail("브랜드 아이디가 기존 계정과 충돌합니다.", 409);
  }
  let newPeople = 0;
  for (const person of parsed.people) {
    if (
      db.prepare("SELECT 1 FROM blocked_emails WHERE email=?").get(person.email)
    )
      fail("차단된 이메일이 포함되어 있어 신청 명단을 가져올 수 없습니다.", 409);
    const existing = db
      .prepare("SELECT role FROM users WHERE email=?")
      .get(person.email) as any;
    if (existing && existing.role !== "influencer")
      fail("신청 이메일이 다른 유형의 기존 계정과 충돌합니다.", 409);
    if (!existing) newPeople++;
  }
  const summary = {
    issues: parsed.issues,
    people: parsed.people.length,
    applications: parsed.applications.length,
    new_influencers: newPeople,
    brands: secondProjectBrands.map((b) => ({
      username: b.username,
      name: b.name,
      applications: parsed.applications.filter((a) => a.username === b.username)
        .length,
    })),
    secondary_consent_pending: parsed.applications.filter((a) => !a.secondary)
      .length,
    original_consent_pending: parsed.applications.length,
  };
  if (dryRun)
    return {
      ...summary,
      imported: 0,
      accounts_created: 0,
      brands_created: 0,
      campaigns: [] as { username: string; id: number }[],
    };
  const hashes = new Map(
    parsed.people
      .filter(
        (p) => !db.prepare("SELECT id FROM users WHERE email=?").get(p.email),
      )
      .map((p) => [p.email, hashPassword("0000")]),
  );
  const brandHashes = new Map(
    secondProjectBrands
      .filter(
        (b) =>
          !db.prepare("SELECT id FROM users WHERE username=?").get(b.username),
      )
      .map((b) => [b.username, hashPassword("0000")]),
  );
  return db.transaction(() => {
    const campaigns = new Map<string, number>();
    let accountsCreated = 0,
      brandsCreated = 0,
      imported = 0;
    for (const b of secondProjectBrands) {
      let brand = db
        .prepare("SELECT id FROM users WHERE username=?")
        .get(b.username) as any;
      if (!brand) {
        const r = db
          .prepare(
            "INSERT INTO users(email,username,name,brand_name,role,password_hash,must_change_password) VALUES(?,?,?,?,'brand',?,1)",
          )
          .run(
            b.username,
            b.username,
            b.name,
            b.name,
            brandHashes.get(b.username),
          );
        brand = { id: Number(r.lastInsertRowid) };
        brandsCreated++;
      }
      const key = `ilovepick-second-project:${b.username}`;
      let campaign = db
        .prepare(
          "SELECT id,brand_id,deleted_at FROM campaigns WHERE import_key=?",
        )
        .get(key) as any;
      if (campaign?.deleted_at)
        fail("삭제된 프로젝트는 다시 등록할 수 없습니다.", 409);
      if (campaign && campaign.brand_id !== brand.id)
        fail("기존 캠페인의 브랜드 소유자가 일치하지 않습니다.", 409);
      if (!campaign) {
        const r = db
          .prepare(
            `INSERT INTO campaigns(brand_id,title,product,description,guidelines,capacity,pay_type,recruit_date,draft_date,final_date,recruit_due,draft_due,final_due,status,is_draft,import_key) VALUES(?,?,?,?,?,50,'gifted','','','',0,0,0,'closed',1,?)`,
          )
          .run(
            brand.id,
            `[I LOVE PICK] 2차 프로젝트 · ${b.name}`,
            b.product,
            `${b.name} ${b.product}. 상세 제품 소개는 브랜드 확인 후 입력합니다.`,
            "엑셀 신청 명단을 등록한 비공개 초안입니다. 모집 인원, 일정과 콘텐츠 가이드라인을 확인한 후 공개해 주세요.",
            key,
          );
        campaign = { id: Number(r.lastInsertRowid) };
      }
      campaigns.set(b.username, campaign.id);
    }
    for (const p of parsed.people) {
      let user = db
        .prepare("SELECT id FROM users WHERE email=?")
        .get(p.email) as any;
      if (!user) {
        const r = db
          .prepare(
            "INSERT INTO users(email,name,phone,role,password_hash,must_change_password) VALUES(?,?,?,'influencer',?,1)",
          )
          .run(p.email, p.name, p.phone, hashes.get(p.email));
        user = { id: Number(r.lastInsertRowid) };
        db.prepare(
          "UPDATE influencer_profiles SET phone=?,social_url=?,import_review_required=1 WHERE user_id=?",
        ).run(p.phone, p.social, user.id);
        accountsCreated++;
      }
    }
    for (const a of parsed.applications) {
      const user = db
        .prepare("SELECT id FROM users WHERE email=?")
        .get(a.email) as any;
      const campaign = campaigns.get(a.username)!;
      const person = parsed.people.find((p) => p.email === a.email)!;
      const r = db
        .prepare(
          `INSERT OR IGNORE INTO applications(campaign_id,influencer_id,consent_at,consent_version,phone,address,secondary_use_consent,original_delivery_consent) VALUES(?,?,0,'external-form-v2-original-pending',?,?,?,0)`,
        )
        .run(campaign, user.id, person.phone, a.address, a.secondary ? 1 : 0);
      if (r.changes) {
        imported++;
        db.prepare(
          "INSERT INTO application_events(application_id,actor_id,status,note,created_at) VALUES(?,?,'applied',?,?)",
        ).run(
          r.lastInsertRowid,
          actor,
          `2차 프로젝트 신청서에서 등록. 제출일: ${a.submitted}. 2차 활용: ${a.secondary ? "원본 신청서 동의" : "추가 확인 필요"}. 고화질 원본 제공: 추가 동의 필요.`,
          Date.now(),
        );
      }
    }
    db.prepare(
      "INSERT INTO admin_audit(actor_id,action,note,created_at) VALUES(?,'second_project_import',?,?)",
    ).run(
      actor,
      JSON.stringify({ accountsCreated, brandsCreated, imported }),
      Date.now(),
    );
    return {
      ...summary,
      imported,
      accounts_created: accountsCreated,
      brands_created: brandsCreated,
      campaigns: secondProjectBrands.map((b) => ({
        username: b.username,
        id: campaigns.get(b.username)!,
      })),
    };
  })();
}
