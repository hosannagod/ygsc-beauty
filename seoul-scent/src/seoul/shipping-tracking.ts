const carriers = [
  {
    aliases: ["cj", "cj대한통운", "대한통운", "cjlogistics"],
    base: "https://www.cjlogistics.com/ko/tool/parcel/tracking",
    parameter: "gnbInvcNo",
  },
  {
    aliases: ["한진", "한진택배", "hanjin"],
    base: "https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do?mCode=MN038",
    parameter: "wblnum",
  },
  {
    aliases: ["롯데", "롯데택배", "롯데글로벌로지스", "lotte"],
    base: "https://www.lotteglogis.com/home/reservation/tracking/linkView",
    parameter: "InvNo",
  },
  {
    aliases: [
      "우체국",
      "우체국택배",
      "우체국소포",
      "epost",
      "koreapost",
    ],
    base: "https://service.epost.go.kr/trace.RetrieveDomRigiTraceList.comm",
    parameter: "sid1",
  },
  {
    aliases: ["로젠", "로젠택배", "logen", "ilogen"],
    base: "https://www.ilogen.com/web/personal/trace/",
    parameter: null,
  },
  {
    aliases: ["dhl", "dhlexpress"],
    base: "https://www.dhl.com/kr-ko/home/tracking.html",
    parameter: "tracking-id",
  },
  {
    aliases: ["fedex", "페덱스"],
    base: "https://www.fedex.com/fedextrack/",
    parameter: "trknbr",
  },
  {
    aliases: ["ups"],
    base: "https://www.ups.com/track",
    parameter: "tracknum",
  },
];
export function shippingTrackingUrl(
  carrier: string,
  tracking: string,
): string | null {
  if (!carrier || !tracking || !/^[A-Za-z0-9-]{5,40}$/.test(tracking))
    return null;
  const key = carrier.toLowerCase().replace(/[\s()._-]/g, "");
  const match = carriers.find((c) => c.aliases.includes(key));
  if (!match) return null;
  const number = tracking.replace(/-/g, "");
  if (!/^[A-Za-z0-9]{5,40}$/.test(number)) return null;
  const url = new URL(match.base);
  if (match.parameter) url.searchParams.set(match.parameter, number);
  else url.pathname += encodeURIComponent(number);
  return url.href;
}
