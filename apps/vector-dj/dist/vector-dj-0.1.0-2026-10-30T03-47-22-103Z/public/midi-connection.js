export class MidiConnection{
  constructor({requestAccess,onMessage=()=>{},onChange=()=>{},onReset=()=>{},onError=()=>{}}={}){
    this.requestAccess=requestAccess||((options)=>{if(!globalThis.navigator?.requestMIDIAccess)throw new Error('Web MIDI is not available in this browser. Try current Chrome.');return navigator.requestMIDIAccess(options);});
    this.onMessage=onMessage;this.onChange=onChange;this.onReset=onReset;this.onError=onError;this.access=null;this.port=null;this.pending=false;this.selecting=false;this.epoch=0;this.selectionEpoch=0;this.selectedId='';
  }
  inputs(){return this.access?[...this.access.inputs.values()].filter(p=>p.state==='connected').map(p=>({id:p.id,name:[p.manufacturer,p.name].filter(Boolean).join(' · ')||p.id})):[];}
  snapshot(){return {pending:this.pending,selecting:this.selecting,connected:!!this.access,selectedId:this.port?.id||'',inputs:this.inputs()};}
  change(){this.onChange(this.snapshot());}
  async connect(){
    if(this.pending||this.access)return;const epoch=++this.epoch;this.pending=true;this.change();
    try{
      const access=await this.requestAccess({sysex:false,software:false});if(epoch!==this.epoch)return;
      this.access=access;this.pending=false;
      access.onstatechange=event=>{
        if(access!==this.access)return;
        if(this.port?.state==='disconnected'){const id=this.port.id;this.port.onmidimessage=null;this.port=null;this.selectionEpoch++;this.onReset(id);}
        this.change();
        if(event.port?.id===this.selectedId&&event.port.state==='connected'&&!this.port&&!this.selecting)this.select(this.selectedId).catch(this.onError);
      };
      this.change();const available=this.inputs();if(available.length===1)await this.select(available[0].id);
    }catch(error){if(epoch!==this.epoch)return;this.pending=false;this.change();throw error;}
  }
  async select(id){
    if(!this.access)throw new Error('Connect MIDI first.');const candidate=this.access.inputs.get(id);if(!candidate||candidate.state!=='connected')throw new Error('This MIDI input is unavailable.');
    const epoch=++this.selectionEpoch,old=this.port;this.port=null;this.selectedId=id;this.selecting=true;this.change();
    try{
      if(old){old.onmidimessage=null;this.onReset(old.id);await old.close();}
      await candidate.open();
      if(epoch!==this.selectionEpoch||!this.access){await candidate.close();return;}
      if(candidate.state!=='connected'){await candidate.close();return;}
      this.port=candidate;candidate.onmidimessage=event=>{if(this.port===candidate){const info=this.inputs().find(p=>p.id===candidate.id)||{id:candidate.id,name:candidate.name||candidate.id};this.onMessage(info,event.data);}};
    }finally{if(epoch===this.selectionEpoch)this.selecting=false;this.change();}
  }
  async disconnect(){
    this.epoch++;this.selectionEpoch++;this.pending=false;this.selecting=false;if(this.access)this.access.onstatechange=null;
    const port=this.port;this.port=null;this.access=null;this.selectedId='';if(port){port.onmidimessage=null;this.onReset(port.id);try{await port.close();}catch(error){this.onError(error);}}this.change();
  }
}
