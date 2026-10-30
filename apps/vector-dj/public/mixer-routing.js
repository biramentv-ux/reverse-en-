import {crossfade} from './dsp.js';
export const DECK_IDS=['a','b','c','d'];
export const DEFAULT_ASSIGNMENTS=['left','right','left','right'];
export function channelBlend(assignment,fade){
  if(!['left','right','thru'].includes(assignment))throw new Error('Choose crossfader LEFT, RIGHT or THRU.');
  if(!Number.isFinite(Number(fade)))throw new Error('Invalid crossfader position.');
  const [left,right]=crossfade(fade);return assignment==='thru'?1:assignment==='left'?left:right;
}
