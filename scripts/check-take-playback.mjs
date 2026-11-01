import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/lib/take-playback.ts',import.meta.url),'utf8');
const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
const {takeMoment,takePitchSamples,takePitchCount}=await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const take={settings:{rate:1,target:0,parts:[{channel:0,transpose:-12}]},transport:[
 {time:0,scoreTime:3,playing:false,rate:1,targetChannel:0,transpose:-12},
 {time:3,scoreTime:3,playing:true,rate:1,targetChannel:0,transpose:-12},
 {time:5,scoreTime:3,playing:true,rate:1,targetChannel:0,transpose:-12},
 {time:6,scoreTime:4,playing:false,rate:1,targetChannel:0,transpose:-12},
 {time:8,scoreTime:4,playing:true,rate:.5,targetChannel:0,transpose:-7},
],pitches:[
 {time:3.1,scoreTime:3.1,frequency:220,targetChannel:0,playing:true},
 {time:4.9,scoreTime:4.9,frequency:221,targetChannel:0,playing:true},
 {time:5.1,scoreTime:3.1,frequency:219,targetChannel:0,playing:true},
 {time:6.1,scoreTime:4,frequency:0,targetChannel:0,playing:false},
 {time:8.1,scoreTime:4.05,frequency:220,targetChannel:0,playing:true,staff:2,transpose:-7,epoch:12},
]};
assert.equal(takeMoment(take,2).scoreTime,3,'count-in stays still');
assert.equal(takeMoment(take,4).scoreTime,4);
assert.equal(takeMoment(take,5).scoreTime,3,'loop jumps at the recorded WAV time');
assert.equal(takeMoment(take,7).scoreTime,4,'pause stays still');
assert.equal(takeMoment(take,10).scoreTime,5,'tempo change uses recorded rate');
const samples=takePitchSamples(take,{parts:[{channel:0,staves:[1]}]});
assert.equal(samples[0].transpose,-12);assert.equal(samples[0].staff,1);
assert.notEqual(samples[1].epoch,samples[2].epoch,'loop does not connect pitch paths backwards');
assert.equal(samples[4].epoch,12);assert.equal(samples[4].staff,2);assert.equal(samples[4].transpose,-7);
assert.equal(samples[0].frequency,220,'measured pitch retained');
assert.equal(takePitchCount(samples,3),0);assert.equal(takePitchCount(samples,5.1),3);assert.equal(takePitchCount(samples,100),5);
assert.equal(takeMoment({...take,transport:[]},0).playing,false);
console.log('PASS recorded playback: count-in, pause, loop, tempo, original pitch/staff/transpose and seeking');
