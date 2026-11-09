#!/usr/bin/env node
// Build a reviewable campaign report from Seoul Scent's completed applications.
// Public TikTok figures are collected from the post page. Other figures stay blank
// until a browser session or an operator supplies a checked measurement.
const { request, chromium } = require('playwright');
const ExcelJS = require('exceljs');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const args = process.argv.slice(2);
const option = (flag, fallback = '') => {
  const index = args.indexOf(flag);
  return index < 0 ? fallback : args[index + 1] || fallback;
};
const campaignId = Number(option('--campaign'));
const outputDir = path.resolve(option('--out', path.join(process.cwd(), 'reports')));
const profileDir = option('--profile');
const metricsXlsx = option('--metrics-xlsx');
const collect = args.includes('--collect');
const capture = args.includes('--capture');
const approved = args.includes('--approve');
const base = process.env.SEOUL_SCENT_ORIGIN || 'https://seoul-scent.onrender.com';
if (!Number.isSafeInteger(campaignId) || campaignId < 1) {
  console.error('Usage: node scripts/campaign-final-report.cjs --campaign ID [--collect] [--capture --profile CHROME_PROFILE_DIR] [--metrics-xlsx EDITED_XLSX] [--approve] [--out DIR]');
  process.exit(2);
}
if (capture && !profileDir) throw Error('--capture requires an explicitly supplied signed-in --profile directory');
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const asNumber = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.floor(Number(value)) : null;
const platform = raw => {
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'instagram.com') return 'Instagram';
    if (['tiktok.com','vt.tiktok.com','vm.tiktok.com'].includes(host)) return 'TikTok';
    if (['youtube.com','youtu.be','m.youtube.com'].includes(host)) return 'YouTube';
    if (host === 'facebook.com' || host === 'fb.watch') return 'Facebook';
    if (host === 'threads.com' || host === 'threads.net') return 'Threads';
    return host;
  } catch { return 'Other'; }
};
const canonical = raw => {
  try {
    const url = new URL(raw.trim());
    return `${url.hostname.toLowerCase().replace(/^www\./, '')}${url.pathname.replace(/\/$/, '')}`;
  } catch { return raw.trim(); }
};
const countryLabel = value => ({Brasil:'브라질',Brazil:'브라질',Indonesia:'인도네시아',South_Korea:'한국',대한민국:'한국'})[value] || value || '미등록';
const today = () => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const stamp = ms => new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(ms));
const inputStamp = ms => new Date(ms+9*3600_000).toISOString().slice(0,16).replace('T',' ');

async function fetchSource() {
  if (!process.env.SEOUL_SCENT_ADMIN_EMAIL || !process.env.SEOUL_SCENT_ADMIN_PASSWORD)
    throw Error('SEOUL_SCENT_ADMIN_EMAIL and SEOUL_SCENT_ADMIN_PASSWORD are required');
  const api = await request.newContext({proxy:process.env.HTTPS_PROXY ? {server:process.env.HTTPS_PROXY} : undefined});
  try {
    const login = await api.post(`${base}/api/login`, {data:{email:process.env.SEOUL_SCENT_ADMIN_EMAIL,password:process.env.SEOUL_SCENT_ADMIN_PASSWORD}});
    if (!login.ok()) throw Error(`Admin login failed: HTTP ${login.status()}`);
    const [detail, exportFile] = await Promise.all([
      api.get(`${base}/api/work/campaigns/${campaignId}`),
      api.get(`${base}/api/work/campaigns/${campaignId}/results.xlsx`),
    ]);
    if (!detail.ok() || !exportFile.ok()) throw Error(`Campaign data unavailable: HTTP ${detail.status()}, ${exportFile.status()}`);
    const campaign = await detail.json();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await exportFile.body());
    const rows = workbook.worksheets[0].getSheetValues().slice(2).filter(Boolean);
    const linksByApplication = new Map(rows.map(row => [Number(row[1]),String(row[6] || '').split(/\r?\n/).map(x=>x.trim()).filter(Boolean)]));
    return {campaign:campaign.campaign,applications:campaign.applications,linksByApplication};
  } finally { await api.dispose(); }
}

async function loadMetrics(file) {
  try { return JSON.parse(await fs.readFile(file,'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}
async function importMetrics(file,metrics) {
  if (!file) return metrics;
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(file);
  const sheet = book.worksheets[0];
  const headers = new Map();
  sheet.getRow(1).eachCell((value,index)=>headers.set(String(value.value||''),index));
  const cell = (row,name) => String(row.getCell(headers.get(name)||0).value ?? '').trim();
  for (let n=2;n<=sheet.rowCount;n++) {
    const row=sheet.getRow(n),url=cell(row,'게시물 URL');
    if (!url) continue;
    const key=canonical(url),group=cell(row,'원본 콘텐츠 그룹'),rawTime=cell(row,'확인 시각 (KST)');
    const numbers=['조회수','좋아요','댓글','공유'].map(name=>{
      const value=cell(row,name);
      if (!value) return null;
      const parsed=asNumber(value.replace(/,/g,''));
      if (parsed===null) throw Error(`Invalid ${name} in row ${n}`);
      return parsed;
    });
    if (numbers.some(value=>value!==null) && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(rawTime))
      throw Error(`Row ${n}: enter 확인 시각 (KST) as YYYY-MM-DD HH:MM`);
    const checkedAt=rawTime?Date.parse(rawTime.replace(' ','T')+'+09:00'):null;
    if (rawTime && !Number.isFinite(checkedAt)) throw Error(`Invalid checked time in row ${n}`);
    metrics[key]={...metrics[key],...(group?{original_group:group}:{}),
      ...(checkedAt?{views:numbers[0],likes:numbers[1],comments:numbers[2],shares:numbers[3],checked_at:checkedAt,source:cell(row,'확인 출처')||'브라우저 확인',error:undefined}:{})};
  }
  return metrics;
}

async function collectTikTok(url, browser) {
  const page = await browser.newPage();
  try {
    const response = await page.goto(url,{waitUntil:'domcontentloaded',timeout:25000});
    if (!response?.ok()) throw Error(`HTTP ${response?.status() ?? 'unknown'}`);
    const html = await page.content();
    const match = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">([^<]+)<\/script>/);
    if (!match) throw Error('TikTok post data unavailable');
    const data = JSON.parse(match[1]).__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct;
    if (!data?.id || !data.stats) throw Error('TikTok post metrics unavailable');
    const videoId=/\/video\/(\d+)/.exec(page.url())?.[1];
    if (videoId && videoId!==data.id) throw Error('TikTok post ID did not match the page');
    const stats = data.stats;
    return {url:page.url(),views:asNumber(stats.playCount),likes:asNumber(stats.diggCount),comments:asNumber(stats.commentCount),shares:asNumber(stats.shareCount),checked_at:Date.now(),source:'TikTok post page'};
  } finally { await page.close(); }
}

async function gatherMetrics(posts, metrics) {
  if (!collect && !capture) return metrics;
  const temporaryProfile = profileDir ? null : await fs.mkdtemp(path.join(os.tmpdir(),'seoul-report-browser-'));
  const browser = await chromium.launchPersistentContext(profileDir || temporaryProfile, {
    executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox'],
    proxy:process.env.HTTPS_PROXY ? {server:process.env.HTTPS_PROXY} : undefined,
  });
  try {
    const unique = [...new Map(posts.map(p=>[p.key,p])).values()];
    for (const [index,post] of unique.entries()) {
      if (metrics[post.key]?.checked_at) continue;
      if (post.platform !== 'TikTok' && !capture) continue;
      try {
        if (post.platform === 'TikTok' && collect) {
          metrics[post.key] = await collectTikTok(post.url,browser);
        } else if (capture) {
          const page = await browser.newPage();
          try {
            await page.goto(post.url,{waitUntil:'domcontentloaded',timeout:25000});
            await page.waitForTimeout(2500);
            const evidenceDir=path.join(outputDir,`campaign-${campaignId}-evidence`);
            await fs.mkdir(evidenceDir,{recursive:true});
            const evidenceFile=path.join(evidenceDir,`${crypto.createHash('sha256').update(post.key).digest('hex').slice(0,16)}.png`);
            await page.screenshot({path:evidenceFile,fullPage:true});
            metrics[post.key]={...metrics[post.key],evidence_file:evidenceFile,source:'browser screenshot awaiting review'};
          } finally { await page.close(); }
        }
      } catch (error) {
        metrics[post.key] = {...metrics[post.key],error:String(error.message).slice(0,140),checked_at:null};
      }
      if ((index+1)%10===0) console.log(`Checked ${index+1}/${unique.length} posts`);
    }
  } finally {
    await browser.close();
    if (temporaryProfile) await fs.rm(temporaryProfile,{recursive:true,force:true});
  }
  return metrics;
}

const table = (headers,rows) => `<table><thead><tr>${headers.map(h=>`<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(cell=>`<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const number = value => Number(value).toLocaleString('ko-KR');
function reportHtml(source, posts, metrics) {
  const {campaign,applications} = source;
  const completed = applications.filter(a=>a.status==='completed');
  const uniquePosts = [...new Map(posts.map(p=>[p.key,p])).values()];
  const byPlatform = Object.entries(uniquePosts.reduce((out,p)=>(out[p.platform]=(out[p.platform]||0)+1,out),{})).sort((a,b)=>b[1]-a[1]);
  const byCountry = new Map();
  for (const person of completed) {
    const country = countryLabel(person.nationality);
    const current = byCountry.get(country) || {creators:0,posts:0};
    current.creators++;
    current.posts += new Set(posts.filter(p=>p.applicationId===person.id).map(p=>p.key)).size;
    byCountry.set(country,current);
  }
  const countries = [...byCountry].sort((a,b)=>b[1].creators-a[1].creators || a[0].localeCompare(b[0]));
  const verified = uniquePosts.map(p=>({...p,metric:metrics[p.key]})).filter(p=>p.metric?.checked_at);
  const grouped = uniquePosts.every(p=>metrics[p.key]?.original_group);
  const originalCount = grouped ? new Set(uniquePosts.map(p=>metrics[p.key].original_group)).size : null;
  const byViews = verified.filter(p=>p.metric.views!==null && p.metric.views!==undefined).sort((a,b)=>b.metric.views-a.metric.views).slice(0,3);
  const byEngagement = verified.filter(p=>p.metric.likes!==null && p.metric.comments!==null && p.metric.likes!==undefined && p.metric.comments!==undefined)
    .sort((a,b)=>(b.metric.likes+b.metric.comments)-(a.metric.likes+a.metric.comments)).slice(0,3);
  const top = (items,type) => items.length ? table(type==='views' ? ['순위','계정','채널','조회수','게시물'] : ['순위','계정','채널','좋아요+댓글','게시물'],items.map((p,i)=>[
    `${i+1}`,escape(p.name),escape(p.platform),number(type==='views'?p.metric.views:p.metric.likes+p.metric.comments),`<a href="${escape(p.url)}">열기 ↗</a>`
  ])) : '<p class="empty">확인된 수치가 없습니다.</p>';
  const fonts = fs.readFile(path.join(__dirname,'../public/pretendard-variable.woff2')).then(x=>x.toString('base64'));
  return fonts.then(font=>`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escape(campaign.brand_name)} 최종보고서</title><style>
  @font-face{font-family:Pretendard;src:url(data:font/woff2;base64,${font}) format('woff2')}*{box-sizing:border-box}
  @page{size:A4;margin:0}body{margin:0;background:#edf0f6;color:#171b34;font:13px Pretendard,Arial,sans-serif}
  .page{width:210mm;height:297mm;background:#fff;margin:12mm auto;padding:20mm 19mm;position:relative;page-break-after:always;overflow:hidden;box-shadow:0 8px 28px #1a194019}
  .page:last-child{page-break-after:auto}.eyebrow{font-size:10px;letter-spacing:.22em;font-weight:800;color:#6845c8}.rule{height:2px;background:linear-gradient(90deg,#292155,#8a6be2);margin:12px 0 24px}
  h1{font-size:26px;line-height:1.3;margin:0 0 10px}h2{font-size:19px;margin:25px 0 12px}h3{font-size:15px;margin:20px 0 10px}p{line-height:1.65;margin:8px 0;color:#4b5067}
  .sub{font-size:15px;color:#54576c}.meta{display:grid;grid-template-columns:100px 1fr;gap:7px 12px;margin:20px 0 25px}.meta b{color:#20213b}
  .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin:20px 0}.cards.three{grid-template-columns:repeat(3,1fr)}.card{border:1px solid #ddd9f2;border-radius:9px;padding:15px 10px;background:#faf9ff}.card small{display:block;color:#756f91;font-size:10px}.card strong{font-size:21px;display:block;margin-top:8px}
  table{width:100%;border-collapse:collapse;font-size:11px;margin:11px 0 15px}th,td{border:1px solid #d9dce5;padding:8px 9px;text-align:left;vertical-align:top}th{background:#f0edfa;color:#292048}td a{color:#5e40b8;text-decoration:none}
  .note{font-size:11px;color:#777b8b}.empty{padding:15px;background:#f5f5f8;border-radius:6px}.footer{position:absolute;bottom:15mm;left:19mm;right:19mm;display:flex;justify-content:space-between;font-size:10px;color:#9698a4;border-top:1px solid #e4e5ec;padding-top:8px}
  .pill{display:inline-block;background:#efeafb;color:#563a9e;padding:5px 9px;border-radius:20px;font-size:10px;font-weight:700;margin:0 0 15px}
  .country table th,.country table td{padding:5px 8px;font-size:10px}.country .note{margin-top:3px}
  @media print{body{background:#fff}.page{margin:0;box-shadow:none}}
  </style></head><body>
  <section class="page"><div class="eyebrow">SEOUL SCENT · CAMPAIGN REPORT</div><div class="rule"></div><span class="pill">${approved?'운영자 검수 완료':'검수 초안 · 브랜드 발송 전 확인 필요'}</span><h1>${escape(campaign.brand_name)} 캠페인<br>최종 결과보고서</h1><p class="sub">${escape(campaign.title)}</p>
  <div class="meta"><b>보고 기준일</b><span>${today()} (KST)</span><b>대상 제품</b><span>${escape(campaign.product)}</span><b>집계 대상</b><span>플랫폼에서 활동 완료로 확인된 계정과 제출 URL</span></div>
  <h2>최종 실적</h2><div class="cards"><div class="card"><small>활동 완료 크리에이터</small><strong>${number(completed.length)}명</strong></div><div class="card"><small>등록 URL</small><strong>${number(posts.length)}개</strong></div><div class="card"><small>동일 URL 제외 게시물</small><strong>${number(uniquePosts.length)}개</strong></div><div class="card"><small>중복 제외 원본 콘텐츠</small><strong>${originalCount===null?'미확인':`${number(originalCount)}건`}</strong></div></div>
  <p class="note">원본 콘텐츠 그룹을 모든 게시물에 지정한 경우에만 채널 간 중복을 제외한 원본 콘텐츠 수를 표시합니다.</p>
  <h2>채널별 게시 현황</h2>${table(['채널','게시물','구성비'],byPlatform.map(([name,count])=>[escape(name),`${number(count)}개`,`${(count/uniquePosts.length*100).toFixed(1)}%`]))}
  <div class="footer"><span>SEOUL SCENT · 브랜드 최종보고서</span><span>1 / 4</span></div></section>
  <section class="page"><div class="eyebrow">PERFORMANCE SNAPSHOT</div><div class="rule"></div><h1>공개 성과 상위 콘텐츠</h1><p>게시물 화면에서 확인된 수치만 사용했습니다. 수치는 확인 이후 변경될 수 있습니다.</p>
  <div class="cards three"><div class="card"><small>성과 확인 게시물</small><strong>${number(verified.length)}개</strong></div><div class="card"><small>조회수 확인</small><strong>${number(verified.filter(p=>p.metric.views!==null&&p.metric.views!==undefined).length)}개</strong></div><div class="card"><small>반응수 확인</small><strong>${number(verified.filter(p=>p.metric.likes!==null&&p.metric.comments!==null&&p.metric.likes!==undefined&&p.metric.comments!==undefined).length)}개</strong></div></div>
  <h2>조회수 상위 3건</h2>${top(byViews,'views')}<h2>좋아요 + 댓글 상위 3건</h2>${top(byEngagement,'reactions')}
  <p class="note">상위 순위는 수치가 확인된 게시물 안에서만 산정합니다. 확인되지 않은 조회수나 숨김 반응은 0으로 처리하지 않습니다.</p>
  <div class="footer"><span>SEOUL SCENT · 브랜드 최종보고서</span><span>2 / 4</span></div></section>
  <section class="page country"><div class="eyebrow">CREATOR GEOGRAPHY</div><div class="rule"></div><h1>국가 및 지역별 제작 현황</h1><p>크리에이터 계정의 등록 국적 기준입니다. 실제 시청자 국가별 도달 현황과는 다릅니다.</p>
  ${table(['등록 국적','크리에이터','게시물'],countries.map(([name,value])=>[escape(name),`${number(value.creators)}명`,`${number(value.posts)}개`]))}
  <p class="note">복수 국적과 과거 추정 입력값은 계정에 저장된 표기를 그대로 사용합니다. 브랜드에 제공하기 전 확인이 필요합니다.</p>
  <div class="footer"><span>SEOUL SCENT · 브랜드 최종보고서</span><span>3 / 4</span></div></section>
  <section class="page"><div class="eyebrow">METHODOLOGY & SOURCES</div><div class="rule"></div><h1>집계 기준과 확인 내역</h1>
  <h3>게시물 수량</h3><p>활동 완료 크리에이터가 플랫폼에 등록한 SNS 링크를 집계했습니다. URL의 추적 매개변수만 다른 링크는 하나로 처리했습니다. 서로 다른 플랫폼에 올린 같은 원본 콘텐츠는 자동으로 동일하다고 판단하지 않습니다.</p>
  <h3>성과 지표</h3><p>확인된 게시물 ${number(verified.length)}개의 공개 지표만 순위에 사용했습니다. 조회수가 확인된 게시물의 합계는 ${number(verified.filter(p=>p.metric.views!==null&&p.metric.views!==undefined).reduce((sum,p)=>sum+p.metric.views,0))}회이며, 캠페인 전체 조회수나 순도달 수를 뜻하지 않습니다.</p>
  <h3>확인 시점</h3><p>각 게시물의 확인 시각은 첨부 엑셀의 ‘확인 시각’ 열에 기록했습니다. 로그인 또는 접근 제한으로 지표를 확인할 수 없었던 게시물은 빈칸으로 남겼습니다.</p>
  <h3>검토가 필요한 항목</h3><p>채널 간 동일 원본 여부, 국적 등록값, 비공개·삭제 게시물, 누락 URL은 최종 발행 전에 확인해야 합니다. 제출 URL이 없는 별도 집계는 검증된 게시물 수에 더하지 않았습니다.</p>
  <h3>근거 자료</h3><p>서울센트 캠페인 결과 내보내기와 개별 게시물 공개 페이지. 상세 URL, 계정, 지표, 확인 시각은 함께 제공되는 XLSX 파일에 있습니다.</p>
  <div class="footer"><span>SEOUL SCENT · 브랜드 최종보고서</span><span>4 / 4</span></div></section></body></html>`);
}

async function main() {
  await fs.mkdir(outputDir,{recursive:true});
  const source = await fetchSource();
  const completed = source.applications.filter(a=>a.status==='completed');
  const posts = completed.flatMap(a=>(source.linksByApplication.get(a.id) || (a.final_url?[a.final_url]:[]))
    .map(url=>({applicationId:a.id,name:a.influencer_name,country:countryLabel(a.nationality),url,key:canonical(url),platform:platform(url)})));
  const stem = `campaign-${campaignId}-final-report-${today()}`;
  const metricsFile = path.join(outputDir,`campaign-${campaignId}-metrics.json`);
  const metrics = await gatherMetrics(posts,await importMetrics(metricsXlsx,await loadMetrics(metricsFile)));
  await fs.writeFile(metricsFile,JSON.stringify(metrics,null,2));
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('게시물 검수');
  sheet.columns = [
    {header:'지원 ID',key:'applicationId',width:12},{header:'계정',key:'name',width:25},{header:'등록 국적',key:'country',width:20},
    {header:'채널',key:'platform',width:16},{header:'게시물 URL',key:'url',width:65},{header:'원본 콘텐츠 그룹',key:'originalGroup',width:22},{header:'조회수',key:'views',width:13},
    {header:'좋아요',key:'likes',width:13},{header:'댓글',key:'comments',width:13},{header:'공유',key:'shares',width:13},
    {header:'확인 시각 (KST)',key:'checkedAt',width:25},{header:'확인 출처',key:'source',width:25},{header:'화면 근거 파일',key:'evidence',width:45},{header:'확인 상태',key:'status',width:30},
  ];
  sheet.addRows(posts.map(p=>{const m=metrics[p.key]||{};return {...p,originalGroup:m.original_group||'',views:m.views??null,likes:m.likes??null,comments:m.comments??null,shares:m.shares??null,checkedAt:m.checked_at?inputStamp(m.checked_at):'',source:m.source||'',evidence:m.evidence_file||'',status:m.checked_at?'확인':m.error||'미확인'};}));
  sheet.getRow(1).font={bold:true};sheet.views=[{state:'frozen',ySplit:1}];sheet.autoFilter={from:'A1',to:'N1'};
  const xlsxPath=path.join(outputDir,`${stem}.xlsx`);
  await book.xlsx.writeFile(xlsxPath);
  const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  try {
    const page=await browser.newPage();
    await page.setContent(await reportHtml(source,posts,metrics),{waitUntil:'load'});
    await page.evaluate(()=>document.fonts.ready);
    await page.pdf({path:path.join(outputDir,`${stem}.pdf`),format:'A4',printBackground:true,preferCSSPageSize:true});
  } finally { await browser.close(); }
  console.log(JSON.stringify({campaign:campaignId,completed:completed.length,links:posts.length,metrics_checked:Object.values(metrics).filter(m=>m.checked_at).length,pdf:path.join(outputDir,`${stem}.pdf`),xlsx:xlsxPath,metrics:metricsFile}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
