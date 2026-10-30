const {app,BrowserWindow,Menu,dialog}=require('electron');
const path=require('node:path'),fs=require('node:fs');
const {createLocalServer}=require('./static-server.cjs');
const PORT=4318,ORIGIN=`http://127.0.0.1:${PORT}`;
const reportArg=process.argv.find(value=>value.startsWith('--orbit-diagnostics='));
const reportPath=reportArg?.slice('--orbit-diagnostics='.length);
let server,window,midiAllowed=false;
const report={version:app.getVersion(),pid:process.pid,origin:ORIGIN,packaged:app.isPackaged,events:[]};
function note(event,data={}){report.events.push({event,at:new Date().toISOString(),...data});if(reportPath)try{fs.writeFileSync(reportPath,JSON.stringify(report,null,2));}catch{}}
app.enableSandbox();app.commandLine.appendSwitch('force-renderer-accessibility');
app.setPath('userData',path.join(app.getPath('appData'),'ORBIT DJ Studio'));
if(!app.requestSingleInstanceLock())app.quit();
else{
  app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.show();window.focus();}});
  app.whenReady().then(async()=>{
    server=createLocalServer(path.join(__dirname,'..','public'));
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(PORT,'127.0.0.1',resolve);});
    note('server-listening');
    window=new BrowserWindow({width:1440,height:1000,minWidth:980,minHeight:700,title:'ORBIT DJ Studio',backgroundColor:'#101216',show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,webviewTag:false,backgroundThrottling:false,spellcheck:false}});
    const contents=window.webContents,session=contents.session;
    contents.on('page-title-updated',event=>event.preventDefault());
    const local=url=>{try{return new URL(url).origin===ORIGIN;}catch{return false;}};
    session.setPermissionCheckHandler((wc,permission,requestingOrigin)=>permission==='midi'&&midiAllowed&&local(requestingOrigin||wc?.getURL()));
    session.setPermissionRequestHandler(async(wc,permission,callback,details)=>{
      if(permission!=='midi'||!local(details.requestingUrl||wc.getURL())){callback(false);return;}
      try{if(!midiAllowed){const response=await dialog.showMessageBox(window,{type:'question',title:'Connect MIDI',message:'Allow ORBIT to receive messages from local MIDI devices?',detail:'Receive-only controls. SysEx and MIDI output are not used. Permission lasts for this app session.',buttons:['Keep disconnected','Allow MIDI'],defaultId:0,cancelId:0});midiAllowed=response.response===1;}callback(midiAllowed);}catch{callback(false);}
    });
    contents.setWindowOpenHandler(()=>({action:'deny'}));
    contents.on('will-navigate',(event,url)=>{if(!local(url))event.preventDefault();});
    contents.on('will-redirect',(event,url)=>{if(!local(url))event.preventDefault();});
    contents.on('will-attach-webview',event=>event.preventDefault());
    contents.on('render-process-gone',(_event,details)=>note('renderer-gone',{reason:details.reason}));
    contents.on('did-fail-load',(_event,code,description)=>note('load-failed',{code,description}));
    contents.on('did-finish-load',()=>note('renderer-loaded',{url:contents.getURL(),preferences:{nodeIntegration:contents.getLastWebPreferences().nodeIntegration,contextIsolation:contents.getLastWebPreferences().contextIsolation,sandbox:contents.getLastWebPreferences().sandbox}}));
    contents.on('will-prevent-unload',event=>{const answer=dialog.showMessageBoxSync(window,{type:'question',title:'Recording in progress',message:'Keep this window open to finish and save your recording?',buttons:['Keep recording','Close window'],defaultId:0,cancelId:0});if(answer===1)event.preventDefault();});
    window.once('ready-to-show',()=>{window.show();note('window-shown');});
    window.on('closed',()=>{window=null;});
    Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'File',submenu:[{role:'quit'}]},{label:'View',submenu:[{role:'reload'},{type:'separator'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{type:'separator'},{role:'togglefullscreen'}]},{label:'Help',submenu:[{label:'About ORBIT',click:()=>dialog.showMessageBox(window,{type:'info',title:'ORBIT DJ Studio',message:`ORBIT DJ Studio ${app.getVersion()}`,detail:'Four decks. Your music, on this computer.'})}]}]));
    await window.loadURL(ORIGIN);
  }).catch(error=>{note('startup-failed',{message:error.message});dialog.showErrorBox('ORBIT could not start',error.code==='EADDRINUSE'?'Local port 4318 is already in use. Close the other application using it, then start ORBIT again.':error.message);app.quit();});
  app.on('window-all-closed',()=>app.quit());
  app.on('will-quit',()=>{server?.closeAllConnections();server?.close();note('quit');});
}
