import assert from 'node:assert/strict';
import {characters,questions,scoreAnswers,dimensions,evidenceFor} from './apps/tests/moonlit-fate/lib/quiz.ts';
assert.equal(characters.length,13);
assert.equal(new Set(characters.map(c=>c.id)).size,13);
assert.deepEqual([0,1,2,3].map(g=>characters.filter(c=>c.group===g).length),[6,4,2,1]);
assert.equal(characters.find(c=>c.id==='kino')?.name,'基诺');
assert.equal(questions.length,16);
assert.deepEqual(dimensions.map((_,d)=>questions.filter(q=>q.dimension===d).length),[4,4,4,4]);
questions.forEach(q=>{assert.equal(q.options.length,4);assert.deepEqual([...q.values].sort((a,b)=>a-b),[-3,-1,1,3]);});
const witnesses=[];
for(const c of characters){
 const answers=Array(16).fill(0);
 for(let d=0;d<4;d++){
  const ids=questions.flatMap((q,i)=>q.dimension===d?[i]:[]);let found=false;
  for(let code=0;code<256&&!found;code++){let n=code;const picks=ids.map(()=>{const j=n%4;n=Math.floor(n/4);return j;});const sum=ids.reduce((s,id,i)=>s+questions[id].values[picks[i]],0);if(sum===c.vector[d]*4){ids.forEach((id,i)=>answers[id]=picks[i]);found=true;}}
  assert.ok(found,`${c.id} dimension ${d} must be reachable`);
 }
 const r=scoreAnswers(answers);assert.equal(r.matches[0].character.id,c.id);assert.equal(r.matches[0].score,100);assert.deepEqual(r.vector,c.vector);assert.equal(evidenceFor(answers,c).length,3);witnesses.push({character:c.id,answers});
}
for(const bad of [[],Array(15).fill(0),Array(17).fill(0),Array(16),[4,...Array(15).fill(0)],[-1,...Array(15).fill(0)],[NaN,...Array(15).fill(0)]])assert.throws(()=>scoreAnswers(bad));
let seed=17;const next=()=>{seed=(seed*1664525+1013904223)>>>0;return seed>>>24;};
for(let i=0;i<2000;i++){const a=Array.from({length:16},()=>next()%4);const r=scoreAnswers(a);assert.deepEqual(scoreAnswers(a),r);assert.ok(r.matches.every(m=>m.score>=0&&m.score<=100));assert.ok(r.vector.every(v=>v>=-3&&v<=3));for(let j=1;j<characters.length;j++)assert.ok(r.matches[j].score<=r.matches[j-1].score);}
console.log('PASS: all 13 characters independently reachable; 16 questions balanced across 4 dimensions; invalid inputs rejected; 2,000 answer combinations checked; scores deterministic and bounded.');
