import type { DB } from "./workflow.js";
import { fail, integer } from "./workflow.js";
export type CampaignImage = { id?: number; data?: Buffer };
function jpegDimensions(data: Buffer) {
  let offset = 2;
  while (offset + 4 < data.length) {
    if (data[offset] !== 0xff) break;
    while (data[offset] === 0xff) offset++;
    const marker = data[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > data.length) break;
    const length = data.readUInt16BE(offset);
    if (length < 2 || offset + length > data.length) break;
    if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8)
      return {
        height: data.readUInt16BE(offset + 3),
        width: data.readUInt16BE(offset + 5),
      };
    offset += length;
  }
  return null;
}
export function parseCampaignImages(
  db: DB,
  value: unknown,
  campaignId?: number,
): CampaignImage[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length > 4)
    fail("캠페인 사진은 최대 4장까지 등록할 수 있습니다.");
  const seen = new Set<number>();
  return (value as any[]).map((image) => {
    if (!image || typeof image !== "object") fail("사진 정보를 확인해 주세요.");
    if (image.id !== undefined) {
      const id = integer(image.id, "사진 ID", 1);
      if (
        !campaignId ||
        seen.has(id) ||
        !db
          .prepare(
            "SELECT id FROM campaign_images WHERE id=? AND campaign_id=?",
          )
          .get(id, campaignId)
      )
        fail("이 캠페인의 사진만 사용할 수 있습니다.");
      seen.add(id);
      return { id };
    }
    if (
      typeof image.data !== "string" ||
      image.data.length > 550000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)
    )
      fail("사진 크기와 형식을 확인해 주세요.");
    const data = Buffer.from(image.data, "base64");
    if (
      data.length > 400 * 1024 ||
      data.length < 32 ||
      data.readUInt16BE(0) !== 0xffd8 ||
      data.readUInt16BE(data.length - 2) !== 0xffd9
    )
      fail("400KB 이하의 JPG 사진을 등록해 주세요.");
    const size = jpegDimensions(data);
    if (
      !size ||
      size.width < 1 ||
      size.height < 1 ||
      size.width > 1600 ||
      size.height > 1600
    )
      fail("사진의 가로·세로는 1600px 이하여야 합니다.");
    return { data };
  });
}
export function saveCampaignImages(
  db: DB,
  campaignId: number,
  images: CampaignImage[] | null,
) {
  if (images === null) return;
  const keep = images.filter((i) => i.id).map((i) => i.id!);
  for (const row of db
    .prepare("SELECT id FROM campaign_images WHERE campaign_id=?")
    .all(campaignId) as { id: number }[])
    if (!keep.includes(row.id))
      db.prepare("DELETE FROM campaign_images WHERE id=?").run(row.id);
  images.forEach((image, position) => {
    if (image.id)
      db.prepare(
        "UPDATE campaign_images SET position=? WHERE id=? AND campaign_id=?",
      ).run(position, image.id, campaignId);
    else
      db.prepare(
        "INSERT INTO campaign_images(campaign_id,position,data) VALUES(?,?,?)",
      ).run(campaignId, position, image.data!);
  });
}
export function campaignImages(db: DB, campaignId: number) {
  return (
    db
      .prepare(
        "SELECT id FROM campaign_images WHERE campaign_id=? ORDER BY position,id",
      )
      .all(campaignId) as { id: number }[]
  ).map((row) => ({
    id: row.id,
    url: `/api/work/campaigns/${campaignId}/images/${row.id}`,
  }));
}
