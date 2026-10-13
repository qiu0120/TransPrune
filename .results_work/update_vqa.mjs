import fs from 'node:fs/promises';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const base = 'E:/笔记/vla学习/论文复现';
const work = `${base}/.results_work`;
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(`${base}/TransPrune_实验记录.xlsx`));
const main = workbook.worksheets.getItem('主实验');
const detail = workbook.worksheets.getItem('评测明细');
const plan = workbook.worksheets.getItem('实验安排');
if (process.argv.includes('--inspect')) {
  const preview = await workbook.render({sheetName:'主实验',range:'A1:N13',scale:1,format:'png'});
  await fs.writeFile(`${work}/vqa_before_main.png`,new Uint8Array(await preview.arrayBuffer()));
  console.log((await workbook.inspect({kind:'table',range:'评测明细!A25:H27',include:'values,formulas',tableMaxRows:3,tableMaxCols:8,maxChars:3500})).ndjson);
  process.exit(0);
}

const results = [
  {config:'原模型',yesNo:92.22,number:60.05,other:71.06,overall:78.52},
  {config:'TransPrune-High',yesNo:92.11,number:59.47,other:69.76,overall:77.80},
  {config:'TransPrune-Low',yesNo:91.35,number:58.28,other:67.93,overall:76.48},
];
await fs.writeFile(`${work}/vqa_evalai_results.json`,JSON.stringify({source:'用户提供的 EvalAI Test-Dev Result file JSON；Low 已由用户纠正',date:'2026-10-08',results},null,2));
detail.getRange('A60').values=[['VQAv2 在线评分分类结果']];
detail.getRange('A60').format.font={name:'Microsoft YaHei',size:14,bold:true,color:'#243B53'};
detail.getRange('A61').values=[['来源：用户提供的 EvalAI Test-Dev 结果；2026-10-08。overall 为官方总分，非分类分数简单平均。']];
detail.getRange('A49:F49').copyTo(detail.getRange('A63:F63'),'all');
detail.getRange('A63:F63').values=[['配置','Yes/No (%)','Number (%)','Other (%)','Overall (%)','来源']];
detail.getRange('A63:F63').format.rowHeight=38;
detail.getRange('A63:F63').format.wrapText=true;
detail.getRange('A64:F66').values=results.map(r=>[r.config,r.yesNo,r.number,r.other,r.overall,'EvalAI']);
detail.getRange('A64:F66').format.font={name:'Microsoft YaHei',size:10};
detail.getRange('A64:F66').format.rowHeight=26;
detail.getRange('A64:F66').format.verticalAlignment='center';
detail.getRange('B64:E66').setNumberFormat('0.00');
detail.getRange('B64:E66').format.horizontalAlignment='right';
for(let i=0;i<3;i++) {
  const r=25+i;
  if(detail.getRange(`A${r}`).values[0][0]!=='VQAv2') throw new Error('VQAv2 row mismatch');
  detail.getRange(`F${r}`).formulas=[[`=E${64+i}`]];
  detail.getRange(`G${r}`).values=[['已完成并评分']];
  detail.getRange(`H${r}`).values=[['EvalAI Test-Dev 官方在线分数；分类结果见下方；提交JSON含完整test的447793个问题ID。']];
  detail.getRange(`J${r}`).values=[['EvalAI Test-Dev Result file（用户提供的JSON，2026-10-08）']];
  main.getRange(`G${7+i}`).formulas=[[`='评测明细'!F${r}`]];
}
main.getRange('G7:G9').setNumberFormat('0.00');
main.getRange('A4').values=[['已录入20组本地评分和3组VQAv2在线评分；GQA原模型分数待补，空白表示缺少实测值。']];
plan.getRange('H14').values=[['VQAv2三组在线分数已录入；GQA原模型分数待补；其余本地评分已录入。']];
workbook.recalculate();
console.log((await workbook.inspect({kind:'table',range:'主实验!G7:G9',include:'values,formulas',tableMaxRows:3,tableMaxCols:1,maxChars:1200})).ndjson);
const errors=await workbook.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:100},summary:'formula errors',maxChars:1500});
console.log(errors.ndjson);
for(const [sheetName,range,file] of [['主实验','A1:N13','vqa_after_main.png'],['主实验','A29:J35','vqa_after_delta.png'],['评测明细','A60:F66','vqa_after_details.png']]) {
  const image=await workbook.render({sheetName,range,scale:1,format:'png'});
  await fs.writeFile(`${work}/${file}`,new Uint8Array(await image.arrayBuffer()));
}
const outPath=`${base}/outputs/01a114ee-3e9e-7201-9c69-54d36a5b0930/TransPrune_实验记录.xlsx`;
await (await SpreadsheetFile.exportXlsx(workbook)).save(outPath);
console.log(`EXPORTED ${outPath}`);
