const fs = require("node:fs");
const dictionary = JSON.parse(
  fs.readFileSync("public/translations.json", "utf8"),
);
fs.writeFileSync(
  "public/i18n.js",
  `(() => {
const dictionary = ${JSON.stringify(dictionary)};
const lang = document.documentElement.lang === "en" ? "en" : "ko";
const pattern = new RegExp(Object.keys(dictionary).sort((a,b)=>b.length-a.length).map(k=>k.replace(/[.*+?^\u0024{}()|[\\]\\\\]/g,"\\\\$&")).join("|"), "g");
const t = value => lang === "en" ? String(value ?? "").replace(/\\s+/g," ").replace(pattern,k=>dictionary[k]) : String(value ?? "");
const html = (strings,...values) => strings.reduce((out,part,i)=>out+t(part)+(i<values.length ? String(values[i] ?? "") : ""), "");
const message = value => {
if (lang !== "en") return value;
if (dictionary[value]) return dictionary[value];
const key = Object.keys(dictionary).find(key => key.length > 8 && value.endsWith(": " + key));
return key ? value.slice(0, -key.length) + dictionary[key] : value;
};
window.ScentI18n = {t,html,lang,message};
document.querySelector("#language-select")?.addEventListener("change",event=>{
const value = event.target.value === "en" ? "en" : "ko";
document.cookie = \`scent_language=\u0024{value}; Path=/; Max-Age=31536000; SameSite=Lax\u0024{location.protocol === "https:" ? "; Secure" : ""}\`;
location.reload();
});
})();\n`,
);
