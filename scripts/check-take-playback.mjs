import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/lib/take-playback.ts',import.meta.url),'utf8');
const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
const {takeMoment,takePitchSamples,takePitchCount,takeTraceStarts}=await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
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
const longPassage=Array.from({length:2500},(_,index)=>({...samples[0],captureTime:index/35,scoreTime:index/35}));
const starts=takeTraceStarts(longPassage);
assert.equal(starts.at(-1),0,'a long passage retains its first pitch point');
assert.equal(longPassage.slice(starts.at(-1),takePitchCount(longPassage,100)).length,2500,'no 800-point rolling cutoff');
longPassage.push({...samples[0],captureTime:100,scoreTime:0});
assert.equal(takeTraceStarts(longPassage).at(-1),2500,'a backwards score jump starts a new trace');
console.log('PASS recorded playback: count-in, pause, loop, tempo, original pitch/staff/transpose and seeking');

// The capture clock carries musical context as well as transport boundaries.
const timelineSource = await readFile(new URL('../src/lib/timeline.ts', import.meta.url), 'utf8');
const timelineJS = ts.transpileModule(timelineSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { CaptureTimeline } = await import(`data:text/javascript;base64,${Buffer.from(timelineJS).toString('base64')}`);
const timeline = new CaptureTimeline();
const initial = { captureTime: 10, scoreTime: 2, rate: 1, playing: true, targetChannel: 0, transpose: 0 };
assert.equal(timeline.observe(initial), true);
const musicalEpoch = timeline.epoch;
assert.equal(timeline.observe({ ...initial, captureTime: 10.5, scoreTime: 2.5 }), false, 'An unchanged context is not a new boundary');
assert.equal(timeline.observe({ ...initial, captureTime: 11, scoreTime: 3, targetChannel: 1 }), true);
const transposed = { ...initial, captureTime: 11.25, scoreTime: 3.25, targetChannel: 1, transpose: -12 };
assert.equal(timeline.observe(transposed), true);
transposed.targetChannel = 99; transposed.transpose = 99;
assert.equal(timeline.at(11.25).targetChannel, 1, 'History owns immutable snapshots, not mutable UI references');
assert.equal(timeline.at(11.25).transpose, -12);
assert.equal(timeline.at(10.75).targetChannel, 0, 'Delayed observations keep their captured voice');
assert.equal(timeline.at(11).targetChannel, 1, 'A boundary applies at its exact capture time');
assert.equal(timeline.at(11.125).transpose, 0);
assert.equal(timeline.epoch, musicalEpoch, 'Voice and transpose edits do not discard previous confirmed points');
const context = { ...initial, targetChannel: 1, transpose: -12 };
timeline.observe({ ...context, captureTime: 12, scoreTime: 4, rate: .5 });
assert.equal(timeline.at(12.5).scoreTime, 4.25);
timeline.observe({ ...context, captureTime: 13, scoreTime: 4.5, rate: .5, playing: false });
assert.equal(timeline.at(13.5).scoreTime, 4.5);
timeline.observe({ ...context, captureTime: 14, scoreTime: 4.5, rate: .5, playing: false, targetChannel: 2, transpose: 7 });
assert.equal(timeline.at(13.5).targetChannel, 1);
assert.equal(timeline.at(14).targetChannel, 2);
assert.equal(timeline.at(14).transpose, 7, 'Musical changes are recorded even while paused');
assert.equal(timeline.epoch, musicalEpoch);
timeline.observe({ ...context, captureTime: 15, scoreTime: 4.5, rate: .5, targetChannel: 2, transpose: 7 });
assert.equal(timeline.at(15.5).scoreTime, 4.75);
timeline.observe({ ...context, captureTime: 16, scoreTime: 1, rate: .5, targetChannel: 2, transpose: 7 }, true);
assert.notEqual(timeline.epoch, musicalEpoch, 'A backwards seek starts a new transport epoch');
assert.equal(timeline.at(15.5).epoch, musicalEpoch);
assert.equal(timeline.at(16).scoreTime, 1);
timeline.observe({ ...context, captureTime: 16, scoreTime: 1, rate: .5, targetChannel: 3, transpose: -5 });
assert.equal(timeline.at(16).targetChannel, 3, 'The last edit wins when edits share an audio sample time');
assert.equal(timeline.at(16).transpose, -5);
const previousEpoch = timeline.epoch;
timeline.observe({ ...initial, captureTime: 1, scoreTime: 0, targetChannel: 4, transpose: 12 });
assert(timeline.epoch > previousEpoch, 'A restarted microphone clock discards its old context');
assert.equal(timeline.at(.5), null); assert.equal(timeline.at(1).targetChannel, 4);
timeline.reset(); assert.equal(timeline.at(1), null);
const steady = new CaptureTimeline();
steady.observe(initial);
steady.observe({ ...initial, captureTime: 11, scoreTime: 3, targetChannel: 1, transpose: 12 });
assert.equal(steady.observe({ ...initial, captureTime: 100, scoreTime: 92, targetChannel: 1, transpose: 12 }), false);
assert.equal(steady.at(99.5).transpose, 12, 'Pruning retains the preceding boundary through a long steady passage');
const compensated = new CaptureTimeline();
compensated.observe(initial);
compensated.observe({ ...initial, captureTime: 11, scoreTime: 3, targetChannel: 1, transpose: 5 });
assert.equal(compensated.at(11.125 - .25).targetChannel, 0, 'Positive microphone latency applies to the whole historical moment');
assert.equal(compensated.at(10.875 + .25).transpose, 5, 'Negative microphone latency uses the corresponding later context');
console.log('PASS capture timeline: delayed musical context, exact/shared boundaries, pause/resume/rate/seek, clock restart, retention and latency');
