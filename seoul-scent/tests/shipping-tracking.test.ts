import { test } from "node:test";
import assert from "node:assert/strict";
import { shippingTrackingUrl } from "../src/seoul/shipping-tracking.js";
test("tracking uses fixed carrier domains, preserves zero prefixes and recognizes common names", () => {
  assert.equal(
    shippingTrackingUrl("CJ 대한통운", "00123456789"),
    "https://www.cjlogistics.com/ko/tool/parcel/tracking?gnbInvcNo=00123456789",
  );
  assert.equal(
    new URL(shippingTrackingUrl("한진택배", "00123-456789")!).searchParams.get(
      "wblnum",
    ),
    "00123456789",
  );
  for (const carrier of [
    "롯데택배",
    "우체국택배",
    "로젠택배",
    "DHL Express",
    "FedEx",
    "UPS",
  ])
    assert.match(shippingTrackingUrl(carrier, "00123456789")!, /^https:\/\//);
  assert.equal(
    shippingTrackingUrl("로젠택배", "00123456789"),
    "https://www.ilogen.com/web/personal/trace/00123456789",
  );
});
test("unknown carriers, missing details and unsafe numbers never produce a link", () => {
  for (const [carrier, number] of [
    ["", "1234567"],
    ["CJ", ""],
    ["other", "1234567"],
    ["https://evil.test", "1234567"],
    ["CJ", "12345&email=private"],
    ["CJ", "javascript:alert(1)"],
  ])
    assert.equal(shippingTrackingUrl(carrier, number), null);
});
