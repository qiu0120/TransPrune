import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const work = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const dir = decodeURIComponent(work);
const inputPath = path.resolve(dir, '../TransPrune_实验记录.xlsx');
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
if (process.argv.includes('--inspect')) {
  const summary = await workbook.inspect({kind:'workbook,sheet,table', maxChars:6000, tableMaxRows:5, tableMaxCols:8});
  await fs.writeFile(path.join(dir, 'artifact_before.txt'), summary.ndjson);
  const image = await workbook.render({sheetName:'主实验',range:'A1:N13',scale:1,format:'png'});
  await fs.writeFile(path.join(dir,'before_main.png'), new Uint8Array(await image.arrayBuffer()));
  console.log('INSPECT AND BEFORE RENDER COMPLETE');
  process.exit(0);
}

const raw = JSON.parse((await fs.readFile(path.join(dir,'server_results.json'),'utf8')).replace(/^\uFEFF/,''));
const find = (bench, config) => raw.runs.find(r => r.benchmark === bench && r.config === config);
const number = (text, pattern) => {
  const match = text.match(pattern);
  if (!match) throw new Error('Missing metric: '+pattern);
  return Number(match[1]);
};
const main = workbook.worksheets.getItem('主实验');
const mme = workbook.worksheets.getItem('MME分项');
const plan = workbook.worksheets.getItem('实验安排');
const detail = workbook.worksheets.add('评测明细');
const configs = ['baseline','high','low'];
const names = {baseline:'原模型',high:'TransPrune-High',low:'TransPrune-Low'};
const benchNames = {mme:'MME',textvqa:'TextVQA',scienceqa:'ScienceQA',pope:'POPE',gqa:'GQA',seed:'SEED-Bench',vqav2:'VQAv2',mmbench:'MMBench'};
const mainCols = {seed:'H',textvqa:'I',scienceqa:'J',pope:'K',gqa:'L',mmbench:'M'};
const proof = [];
const popeDetails = [];
for (const entry of raw.runs) {
  const {benchmark: bench, config, score_text: text} = entry;
  entry.metric = null;
  entry.notes = '';
  entry.metricName = {mme:'Perception',textvqa:'VQA soft accuracy (%)',scienceqa:'IMG-Accuracy (%)',pope:'三类 F1 等权均值 (%)',gqa:'Accuracy (%)',seed:'Image accuracy (%)',vqav2:'Test-dev accuracy (%)',mmbench:'Circular accuracy (%)'}[bench];
  if (entry.complete && text) {
    if (bench === 'mme') {
      entry.metric = number(text,/Perception[^]*?total score:\s*([\d.]+)/);
      entry.cognition = number(text,/Cognition[^]*?total score:\s*([\d.]+)/);
      entry.categories = Object.fromEntries([...text.matchAll(/^\s*(\w+)\s+score:\s*([\d.]+)/gm)].map(m=>[m[1],Number(m[2])]));
      const cats = mme.getRange('B15:B28').values.flat();
      const vals = cats.map(c=>[entry.categories[c]]);
      if (vals.some(v=>!Number.isFinite(v[0]))) throw new Error('Missing MME category');
      const col = ['D','E','F'][configs.indexOf(config)];
      mme.getRange(`${col}15:${col}28`).values=vals;
      if (Math.abs(vals.slice(0,10).reduce((s,v)=>s+v[0],0)-entry.metric)>1e-9) throw new Error('MME total mismatch');
      if (Math.abs(vals.slice(10).reduce((s,v)=>s+v[0],0)-entry.cognition)>1e-9) throw new Error('MME cognition mismatch');
    } else if (bench==='textvqa') entry.metric=number(text,/^Accuracy:\s*([\d.]+)%/m);
    else if (bench==='scienceqa') {
      entry.metric=number(text,/IMG-Accuracy:\s*([\d.]+)%/);
      entry.notes='主表使用图片题准确率；全部题 Accuracy='+number(text,/\bAccuracy:\s*([\d.]+)%/)+'%。';
    } else if (bench==='pope') {
      const rows=[...text.matchAll(/Category:\s*(\w+),\s*# samples:\s*(\d+)([^]*?)(?=Category:|$)/g)].map(m=>{
        const v = label=>number(m[3],new RegExp('^'+label+':\\s*([\\d.]+)','m'));
        const counts=m[3].match(/TP\s+FP\s+TN\s+FN\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/);
        if(!counts) throw new Error('POPE confusion counts unavailable');
        return {config,category:m[1],count:Number(m[2]),acc:v('Accuracy'),precision:v('Precision'),recall:v('Recall'),f1:v('F1 score'),yes:v('Yes ratio'),tp:Number(counts[1]),fp:Number(counts[2]),tn:Number(counts[3]),fn:Number(counts[4]),source:entry.score_path};
      });
      if(rows.length!==3||rows.reduce((s,r)=>s+r.count,0)!==entry.expected_count) throw new Error('POPE categories mismatch');
      for(const r of rows) {
        if(r.tp+r.fp+r.tn+r.fn!==r.count) throw new Error('POPE count mismatch');
        if(Math.abs(2*r.tp/(2*r.tp+r.fp+r.fn)-r.f1)>1e-12) throw new Error('POPE F1 mismatch');
      }
      popeDetails.push(...rows);
      entry.metric=100*rows.reduce((s,r)=>s+r.f1,0)/3;
      entry.notes='采用三类 F1 的等权均值；不是 Accuracy。random=2910，popular/adversarial 各3000题，分项保留在下方。';
    } else if (bench==='gqa') entry.metric=number(text,/^Accuracy:\s*([\d.]+)%/m);
    else if (bench==='seed') {
      const m=text.match(/accuracy:\s*([\d.]+)%\s*\((\d+)\/(\d+)\)/);
      if(!m||Number(m[3])!==entry.expected_count) throw new Error('SEED coverage mismatch');
      entry.metric=100*Number(m[2])/Number(m[3]);
      entry.notes='图片题；答对 '+m[2]+'/'+m[3]+'。';
    } else if (bench==='mmbench') {
      const csv=Object.values(entry.score_csvs||{})[0];
      if(!csv) throw new Error('MMBench CSV unavailable');
      entry.metric=100*number(csv,/"dev","([\d.]+)"/);
      entry.notes='DEV_EN；exact_matching + circular；VLMEvalKit 54a063c5；答案提取与论文在线平台是否一致尚未确认。';
      entry.score_path=Object.keys(entry.score_csvs)[0];
    }
  }
  entry.status=entry.metric!==null?'已完成并评分':entry.complete?(bench==='vqav2'?'推理完成，待在线评分':'推理完成，缺评分'):'未完成';
  if(!entry.complete) entry.notes='回答文件未完整；本次核对 '+entry.answer_count+'/'+entry.expected_count+' 条，未计入分数。';
  if(bench==='vqav2') entry.notes='三组 test-dev 预测均完整；尚无 EvalAI 正式分数，主表留空。';
  const row=7+configs.indexOf(config);
  if(entry.metric!==null&&mainCols[bench]) main.getRange(mainCols[bench]+row).values=[[entry.metric]];
  proof.push({benchmark:bench,config,metric:entry.metric,status:entry.status});
}

main.getRange('K6').values=[['POPE F1']];
main.getRange('K19').values=[['POPE F1']];
main.getRange('H7:M9').setNumberFormat('0.00');
main.getRange('H7:M9').format.horizontalAlignment='right';
main.getRange('F7:F9').setNumberFormat('0.00');
main.getRange('A4').values=[['已录入20组本地评分。VQAv2待在线评分，GQA原模型未完成；空白表示缺少实测值。']];
main.getRange('A13').values=[['POPE采用三类F1等权均值；MMBench采用本地exact_matching/circular，评分口径详见“评测明细”。']];
mme.getRange('G7:G9').values=[[2374],[2374],[2374]];
mme.getRange('H7:H9').values=[['已完成'],['已完成'],['已完成']];
mme.getRange('A11').values=[['三组均2374条完整回答；感知和认知分已与服务器评分日志逐项核对。']];
mme.getRange('A32').values=[['来源：服务器 table1_baseline/high/low 的 mme.score.log；核对日期2026-10-08。']];
mme.getRange('A33').values=[['日志：results/table1_<配置>/logs/mme.score.log；回答：data/MME/answers/table1_<配置>.jsonl。']];

plan.getRange('D8:D10').values=[['已完成'],['已完成'],['已完成']];
for (let i=0;i<3;i++) {
  const r=find('mme',configs[i]);
  plan.getRange('G'+(8+i)).values=[[r.score_path]];
  plan.getRange('H'+(8+i)).values=[['2374/2374条回答；14类分数已核对。']];
}
plan.getRange('B11:D11').values=[['TextVQA 三组','比较 Baseline、High、Low 的 OCR 问答表现','已完成']];
plan.getRange('G11').values=[['results/table1_<配置>/logs/textvqa.score.log']];
plan.getRange('H11').values=[['三组均5000条完整回答，已录入主实验。']];
plan.getRange('D14').values=[['待确认']];
plan.getRange('G14').values=[['详见“评测明细”24组状态和来源路径']];
plan.getRange('H14').values=[['GQA原模型未完成；VQAv2三组待在线评分；其余本地评分已录入。']];
plan.getRange('C36').values=[['已核对服务器回答文件、评分日志和MMBench评分CSV，核对日期2026-10-08。']];

detail.showGridLines=false;
detail.getRange('A2').values=[['表1评测结果与来源']];
detail.getRange('A2').format.font={name:'Microsoft YaHei',size:16,bold:true,color:'#243B53'};
detail.getRange('A4').values=[['核对日期2026-10-08；百分比采用0–100数值。空白表示尚无正式分数，TFLOPs和效率数据尚未测量。']];
const headers=['Benchmark','配置','预期回答数','实际回答数','指标','实测值','状态','说明','回答文件','评分来源','推理日志','核对日期','缺失ID数','额外ID数','空回答数'];
detail.getRange('A6:O6').values=[headers];
const detailRows=raw.runs.map(r=>[benchNames[r.benchmark],names[r.config],r.expected_count,r.answer_count,r.metricName,r.metric,r.status,r.notes,r.answer_path,r.score_path,r.infer_path,new Date('2026-10-08T00:00:00Z'),r.missing_ids,r.extra_ids,r.empty_answers]);
detail.getRange('A7:O30').values=detailRows;
detail.getRange('A6:O30').format.font={name:'Microsoft YaHei',size:10};
detail.getRange('A6:O6').format={fill:'#243B53',font:{name:'Microsoft YaHei',size:10,bold:true,color:'#FFFFFF'},rowHeight:30,verticalAlignment:'center',horizontalAlignment:'center'};
detail.getRange('A7:O30').format.rowHeight=38;
detail.getRange('A7:O30').format.verticalAlignment='center';
detail.getRange('A7:G30').format.wrapText=true;
detail.getRange('A:A').format.columnWidth=22;
detail.getRange('B:B').format.columnWidth=22;
detail.getRange('C:D').format.columnWidth=15;
detail.getRange('E:E').format.columnWidth=30;
detail.getRange('F:F').format.columnWidth=14;
detail.getRange('G:G').format.columnWidth=25;
detail.getRange('H:H').format.columnWidth=110;
detail.getRange('I:K').format.columnWidth=110;
detail.getRange('L:O').format.columnWidth=16;
detail.getRange('C7:D30').setNumberFormat('#,##0');
detail.getRange('F7:F30').setNumberFormat('0.00');
detail.getRange('L7:L30').setNumberFormat('yyyy-mm-dd');
detail.getRange('M7:O30').setNumberFormat('#,##0');
detail.freezePanes.freezeRows(6);
detail.freezePanes.freezeColumns(2);
detail.getRange('G7:G30').conditionalFormats.add('containsText',{text:'未完成',format:{fill:'#FDE9E7',font:{color:'#9C2F2F'}}});
detail.getRange('G7:G30').conditionalFormats.add('containsText',{text:'待在线评分',format:{fill:'#FFF2CC',font:{color:'#805A00'}}});

detail.getRange('A33').values=[['POPE 分类别指标']];
detail.getRange('A33').format.font={name:'Microsoft YaHei',size:14,bold:true,color:'#243B53'};
detail.getRange('A34').values=[['主表使用三类F1等权均值。分类别Accuracy、Precision、Recall、F1、Yes ratio均按0–100记录；论文未明确展开汇总公式。']];
detail.getRange('A36:G36').values=[['配置','类别','题目数','Accuracy (%)','Precision (%)','Recall (%)','F1 (%)']];
detail.getRange('A37:G45').values=popeDetails.map(r=>[names[r.config],r.category,r.count,100*r.acc,100*r.precision,100*r.recall,100*r.f1]);
detail.getRange('A36:G45').format.font={name:'Microsoft YaHei',size:10};
detail.getRange('A36:G36').format={fill:'#243B53',font:{name:'Microsoft YaHei',size:10,bold:true,color:'#FFFFFF'},rowHeight:38,wrapText:true,verticalAlignment:'center',horizontalAlignment:'center'};
detail.getRange('A37:G45').format.rowHeight=26;
detail.getRange('D37:G45').setNumberFormat('0.00');
detail.getRange('C37:C45').setNumberFormat('#,##0');
detail.getRange('A47').values=[['POPE 分类别计数与 Yes ratio']];
detail.getRange('A47').format.font={name:'Microsoft YaHei',size:14,bold:true,color:'#243B53'};
detail.getRange('A49:G49').values=[['配置','类别','TP','FP','TN','FN','Yes ratio (%)']];
detail.getRange('A50:G58').values=popeDetails.map(r=>[names[r.config],r.category,r.tp,r.fp,r.tn,r.fn,100*r.yes]);
detail.getRange('A49:G58').format.font={name:'Microsoft YaHei',size:10};
detail.getRange('A49:G49').format={fill:'#243B53',font:{name:'Microsoft YaHei',size:10,bold:true,color:'#FFFFFF'},rowHeight:30,verticalAlignment:'center',horizontalAlignment:'center'};
detail.getRange('A50:G58').format.rowHeight=26;
detail.getRange('C50:F58').setNumberFormat('#,##0');
detail.getRange('G50:G58').setNumberFormat('0.00');
// The original width of column D serves the POPE header too; wrap preserves both tables.
for (let i=0;i<3;i++) {
  const e=find('pope',configs[i]);
  const dr=7+raw.runs.indexOf(e);
  const start=37+3*i;
  detail.getRange('F'+dr).formulas=[['=AVERAGE(G'+start+':G'+(start+2)+')']];
  main.getRange('K'+(7+i)).formulas=[["='评测明细'!F"+dr]];
}

await fs.copyFile(inputPath,path.join(dir,'workbook_original.xlsx'));
workbook.recalculate();
const inspected=await workbook.inspect({kind:'table',range:'主实验!F6:N9',include:'values,formulas',tableMaxRows:4,tableMaxCols:9,maxChars:4000});
await fs.writeFile(path.join(dir,'after_inspect.txt'),inspected.ndjson);
const errors=await workbook.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:100},summary:'formula errors',maxChars:2000});
await fs.writeFile(path.join(dir,'formula_errors.txt'),errors.ndjson);
for (const [sheetName,range,out] of [['主实验','A1:N13','after_main.png'],['主实验','A28:J35','after_deltas.png'],['MME分项','A6:H28','after_mme.png'],['评测明细','A6:G30','after_detail.png'],['评测明细','A36:G58','after_pope.png'],['实验安排','A6:H14','after_plan.png'],['消融','A6:J12','after_ablation.png']]) {
  const image=await workbook.render({sheetName,range,scale:1,format:'png'});
  await fs.writeFile(path.join(dir,out),new Uint8Array(await image.arrayBuffer()));
}
const outputDir=path.resolve(dir,'../outputs/01a114ee-3e9e-7201-9c69-54d36a5b0930');
await fs.mkdir(outputDir,{recursive:true});
const outPath=path.join(outputDir,'TransPrune_实验记录.xlsx');
await (await SpreadsheetFile.exportXlsx(workbook)).save(outPath);
await fs.writeFile(path.join(dir,'parsed_results.json'),JSON.stringify({proof,popeDetails},null,2));
console.log('EXPORTED '+outPath);
