import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const dir = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(dir, '../TransPrune_实验记录.xlsx');
const backup = path.join(dir, 'current_before_oct13.xlsx');
const inspectOnly = process.argv.includes('--inspect');
if (inspectOnly) await fs.copyFile(target, backup);
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(backup));
const main = workbook.worksheets.getItem('主实验');
if (inspectOnly) {
  const png = await workbook.render({sheetName:'主实验',range:'A1:N13',scale:1,format:'png'});
  await fs.writeFile(path.join(dir,'current_before_oct13.png'), new Uint8Array(await png.arrayBuffer()));
  console.log((await workbook.inspect({kind:'table',range:'主实验!F7:N9',include:'values,formulas',tableMaxRows:3,tableMaxCols:9,maxChars:4000})).ndjson);
  process.exit(0);
}
main.freezePanes.freezeRows(24);
main.freezePanes.freezeColumns(2);

const raw = JSON.parse((await fs.readFile(path.join(dir,'server_results_oct13.json'),'utf8')).replace(/^\uFEFF/,''));
const vqa = [78.52,77.80,76.48];
const configs = ['baseline','high','low'];
const find = (benchmark,config) => raw.runs.find(r=>r.benchmark===benchmark && r.config===config);
const number = (text,pattern) => {
  const match = text.match(pattern);
  if (!match) throw new Error('Missing metric '+pattern);
  return Number(match[1]);
};
const proof = [];
for (const [index,config] of configs.entries()) {
  const row = 7+index;
  for (const [benchmark,column] of [['mme','F'],['seed','H'],['textvqa','I'],['scienceqa','J'],['pope','K'],['gqa','L'],['mmbench','M']]) {
    const run = find(benchmark,config);
    if (!run.complete || !run.score_text) {
      if (benchmark !== 'gqa' || config !== 'baseline') throw new Error('Unexpected missing score');
      main.getRange(column+row).clear({applyTo:'contents'});
      proof.push({benchmark,config,metric:null,answer_count:run.answer_count,expected_count:run.expected_count});
      continue;
    }
    let metric;
    if (benchmark==='mme') metric=number(run.score_text,/Perception[^]*?total score:\s*([\d.]+)/);
    else if (benchmark==='pope') {
      const f1=[...run.score_text.matchAll(/^F1 score:\s*([\d.]+)/gm)].map(m=>Number(m[1]));
      if (f1.length!==3) throw new Error('Expected three POPE categories');
      metric=100*f1.reduce((s,v)=>s+v,0)/3;
    } else if (benchmark==='seed') {
      const m=run.score_text.match(/accuracy:\s*([\d.]+)%\s*\((\d+)\/(\d+)\)/);
      if (!m || Number(m[3])!==run.expected_count) throw new Error('SEED count mismatch');
      metric=100*Number(m[2])/Number(m[3]);
    } else if (benchmark==='scienceqa') metric=number(run.score_text,/IMG-Accuracy:\s*([\d.]+)%/);
    else if (benchmark==='mmbench') metric=100*number(Object.values(run.score_csvs)[0],/"dev","([\d.]+)"/);
    else metric=number(run.score_text,/^Accuracy:\s*([\d.]+)%/m);
    main.getRange(column+row).values=[[metric]];
    proof.push({benchmark,config,metric,source:run.score_path});
  }
  main.getRange('G'+row).values=[[vqa[index]]];
}
main.getRange('A4').values=[['已录入23组确认分数：20组本地评分、3组VQAv2在线评分。GQA原模型未完成，汇总相对性能暂留空。']];
main.getRange('A11').values=[['MME使用评分日志中的感知总分；TFLOPs从“效率”读取。其余七项填写0–100数值，如58.2。']];
main.getRange('A13').values=[['POPE为三类F1等权均值；MMBench为本地exact_matching/circular，和论文在线评分的一致性待确认。核对日期：2026-10-13。']];
for (const item of proof.filter(p=>p.metric!==null)) {
  const column={mme:'F',seed:'H',textvqa:'I',scienceqa:'J',pope:'K',gqa:'L',mmbench:'M'}[item.benchmark];
  const address=column+(7+configs.indexOf(item.config));
  workbook.notes.add({id:'主实验:'+address,target:{cell:{sheetName:'主实验',sheetId:main.sheetId,address}},authorId:'',createdAt:'',body:{plainText:'来源：'+item.source}});
}
for (let i=0;i<3;i++) {
  const address='G'+(7+i);
  workbook.notes.add({id:'主实验:'+address,target:{cell:{sheetName:'主实验',sheetId:main.sheetId,address}},authorId:'',createdAt:'',body:{plainText:'来源：用户提供的EvalAI Test-Dev Result file；'+configs[i]+' overall='+vqa[i]}});
}
// Refresh imported formula caches after replacing inputs and broken references.
const formulas=JSON.parse(await fs.readFile(path.join(dir,'current_formulas.json'),'utf8'));
for (const {sheet,address,formula} of formulas) {
  if (sheet==='主实验' && ['F7','F8','F9','K7','K8','K9'].includes(address)) continue;
  const cell=workbook.worksheets.getItem(sheet).getRange(address);
  cell.clear({applyTo:'contents'});
  cell.formulas=[[formula]];
}
workbook.recalculate();
const errors=await workbook.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:100},maxChars:2000});
await fs.writeFile(path.join(dir,'current_formula_errors.txt'),errors.ndjson);
console.log(errors.ndjson);
console.log((await workbook.inspect({kind:'table',range:'主实验!E7:N9',include:'values,formulas',tableMaxRows:3,tableMaxCols:10,maxChars:5000})).ndjson);
for (const [name,range] of [['main','A1:N13'],['delta','A28:K35']]) {
  const png=await workbook.render({sheetName:'主实验',range,scale:1,format:'png'});
  await fs.writeFile(path.join(dir,'current_after_'+name+'.png'),new Uint8Array(await png.arrayBuffer()));
}
await fs.writeFile(path.join(dir,'current_proof.json'),JSON.stringify(proof,null,2));
await (await SpreadsheetFile.exportXlsx(workbook)).save(path.join(dir,'current_filled_oct13.xlsx'));
console.log('EXPORT COMPLETE');
