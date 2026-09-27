// ── State ──
var S={nozzle_temp:0,nozzle_target:0,bed_temp:0,bed_target:0,
  print_state:'standby',filename:'',progress:0,print_duration:0,remain_time:0,
  curr_layer:0,total_layers:0,z_mm:0,printer_name:'Kobra X',firmware_version:'–',
  camera_url:'',fan_speed:0,print_speed_mode:2,light_on:false,light_brightness:80,
  ams_slots:[],filament_mode:'toolhead',ace_units:[],ace_dry_presets:null,ace_drying:{status:0,target_temp:0,duration:0,remain_time:0,humidity:null,current_temp:null,units:[]},web_upload_warning:1};
var tempHistory={n:[],b:[]};
var camOn=false;
var camUserStopped=false; // user stopped camera manually — suppress auto-restart for this print
var _camPollInterval=null; // snapshot-polling interval for Android (no MJPEG support)
var _lastLoadedFile=null;  // zuletzt geladene/gedruckte Datei für Progress-Karten-Aktionen (Issue #55)
var _idleCleared=false;    // User hat idle-Datei explizit „geleert" → kein Nachladen von s.filename (Issue #57)
var _fdDialogOpen=false;          // Dialog ist gerade offen
var _fdAutoOpenedFile=sessionStorage.getItem('fdAutoOpenedFile')||null;
var _fdUserCancelled=sessionStorage.getItem('fdUserCancelled')==='1';
var currentStep=1;
var currentPanel='dashboard';
var aceAutoRefillPrefs=(function(){
  try{return JSON.parse(localStorage.getItem('aceAutoRefillPrefs')||'{}')||{};}catch(_){return {};}
})();
var aceDryProfiles=(function(){
  try{return JSON.parse(localStorage.getItem('aceDryProfiles')||'{}')||{};}catch(_){return {};}
})();
var _aceDryDialogAceId=-1;
var _aceDryDialogPresetKey='';
var _aceDryDialogPresetOriginals={};
var ACE_DRY_PRESET_DEFAULTS={
  pla:{temp:45,duration_sec:4*3600},
  pla_plus:{temp:45,duration_sec:4*3600},
  petg:{temp:50,duration_sec:4*3600},
  tpu:{temp:55,duration_sec:4*3600},
  abs_asa:{temp:45,duration_sec:8*3600},
  pa_pc:{temp:55,duration_sec:12*3600}
};
var ACE_DRY_PRESETS={
  pla:{temp:45,duration_sec:4*3600},
  pla_plus:{temp:45,duration_sec:4*3600},
  petg:{temp:50,duration_sec:4*3600},
  tpu:{temp:55,duration_sec:4*3600},
  abs_asa:{temp:45,duration_sec:8*3600},
  pa_pc:{temp:55,duration_sec:12*3600},
  custom_1:{name:'Custom 1',temp:45,duration_sec:4*3600},
  custom_2:{name:'Custom 2',temp:45,duration_sec:4*3600},
  custom_3:{name:'Custom 3',temp:45,duration_sec:4*3600}
};

// Spoolman state
var _spoolmanStatus={configured:false,reachable:false,server:'',sync_rate:0,slot_spools:{}};
var _spoolmanSpools=[];
var _slotSpoolMap={};  // {String(global_index): spoolman_spool_id} — last committed assignment

function _loadSpoolmanStatus(){
  fetch(_apiUrl('/kx/spoolman/status')).then(function(r){return r.json();}).then(function(d){
    _spoolmanStatus=d;
    _slotSpoolMap=d.slot_spools||{};
    _updateSpoolmanStatusDot();
    _buildSpoolmanSection();
    renderSpoolmanSlotCard();
    if(d.configured){
      fetch(_apiUrl('/kx/spoolman/spools')).then(function(r){return r.json();}).then(function(sd){
        _spoolmanSpools=sd.spools||[];
      });
    }
  }).catch(function(){});
}
function _updateSpoolmanStatusDot(){
  var dot=document.getElementById('spoolman-status-dot');
  var lbl=document.getElementById('spoolman-status-lbl');
  if(!dot||!lbl)return;
  if(!_spoolmanStatus.configured){
    dot.style.color='var(--txt2)';lbl.textContent='nicht konfiguriert';
  } else if(_spoolmanStatus.reachable){
    dot.style.color='var(--ok)';lbl.textContent=_spoolmanStatus.server||'verbunden';
  } else {
    dot.style.color='var(--err)';lbl.textContent=(_spoolmanStatus.server||'')+' (nicht erreichbar)';
  }
}

function _buildSpoolmanSection(){
  var sec=document.getElementById('fd-spoolman-section');
  var rows=document.getElementById('fd-spoolman-rows');
  var loading=document.getElementById('fd-spoolman-loading');
  if(!sec||!rows)return;
  if(!_spoolmanStatus.configured){sec.style.display='none';return;}
  sec.style.display='';
  rows.innerHTML='';
  if(loading)loading.style.display='';

  var usedSlots={};
  (_amsSlots||[]).forEach(function(slot){
    usedSlots[slot.slot_index]=slot;
  });

  fetch(_apiUrl('/kx/spoolman/spools')).then(function(r){return r.json();}).then(function(d){
    if(loading)loading.style.display='none';
    _spoolmanSpools=d.spools||[];
    var slotKeys=Object.keys(usedSlots).map(Number).sort(function(a,b){return a-b;});
    if(!slotKeys.length){rows.innerHTML='<span style="font-size:11px;color:var(--txt2)">–</span>';return;}
    rows.innerHTML=slotKeys.map(function(idx){
      var slot=usedSlots[idx];
      var col=(slot.color_hex||'#888');
      var currentSpool=_slotSpoolMap[String(idx)]||'';
      var opts='<option value="">–</option>'+_spoolmanSpools.map(function(sp){
        var rem=sp.remaining_weight!=null?' ('+sp.remaining_weight.toFixed(0)+'g)':'';
        var vendor=sp.filament&&sp.filament.vendor?sp.filament.vendor.name+' ':'';
        var name=sp.filament&&sp.filament.name?sp.filament.name:'Spool';
        return '<option value="'+sp.id+'"'+(sp.id==currentSpool?' selected':'')+'>'+
               escHtml('#'+sp.id+' '+vendor+name+rem)+'</option>';
      }).join('');
      return '<div style="display:flex;align-items:center;gap:8px;font-size:12px">'+
        '<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:'+col+';border:1px solid var(--border);flex-shrink:0"></span>'+
        '<span style="color:var(--txt2);min-width:46px">Slot '+(idx+1)+'</span>'+
        '<select data-spool-slot="'+idx+'" style="flex:1;padding:3px 6px;border-radius:6px;border:1px solid var(--border);background:var(--raised);color:var(--txt);font-size:12px">'+
        opts+'</select></div>';
    }).join('');
  }).catch(function(){if(loading)loading.style.display='none';});
}

function _aceAutoRefillGet(aceId){return !!aceAutoRefillPrefs[String(aceId)];}
function _aceAutoRefillSet(aceId,on){
  aceAutoRefillPrefs[String(aceId)]=!!on;
  localStorage.setItem('aceAutoRefillPrefs',JSON.stringify(aceAutoRefillPrefs));
}
function _aceDryProfileGet(aceId){
  var p=aceDryProfiles[String(aceId)]||{};
  var temp=parseInt(p.temp,10);
  var dur=parseInt(p.duration_sec,10);
  if(!Number.isFinite(temp))temp=45;
  if(!Number.isFinite(dur))dur=4*3600;
  temp=Math.max(30,Math.min(80,temp));
  dur=Math.max(10*60,Math.min(24*3600,dur));
  return {temp:temp,duration_sec:dur,preset:p.preset||''};
}
function _aceDryProfileSet(aceId,temp,durationSec,preset){
  aceDryProfiles[String(aceId)]={
    temp:Math.max(30,Math.min(80,parseInt(temp,10)||45)),
    duration_sec:Math.max(10*60,Math.min(24*3600,parseInt(durationSec,10)||4*3600)),
    preset:preset||''
  };
  localStorage.setItem('aceDryProfiles',JSON.stringify(aceDryProfiles));
}
function _aceDryDurationMinFromSec(sec){
  var minutes=Math.round((parseInt(sec,10)||0)/60);
  return Math.max(10,Math.min(1440,minutes));
}
function _syncAceDryPresetsFromServer(raw){
  if(!raw||typeof raw!=='object')return;
  Object.keys(ACE_DRY_PRESETS).forEach(function(k){
    var p=raw[k];
    if(!p||typeof p!=='object')return;
    var t=parseInt(p.temp,10);
    var d=parseInt(p.duration_sec,10);
    if(Number.isFinite(t))ACE_DRY_PRESETS[k].temp=Math.max(30,Math.min(80,t));
    if(Number.isFinite(d))ACE_DRY_PRESETS[k].duration_sec=Math.max(10*60,Math.min(24*3600,d));
    if(/^custom_[123]$/.test(k)&&typeof p.name==='string'){
      var n=p.name.trim();
      ACE_DRY_PRESETS[k].name=n||('Custom '+k.slice(-1));
    }
  });
}

// ── Theme ──
function toggleTheme(){
  var h=document.documentElement;
  h.setAttribute('data-theme',h.getAttribute('data-theme')==='dark'?'light':'dark');
  localStorage.setItem('theme',h.getAttribute('data-theme'));
}
(function(){var t=localStorage.getItem('theme');if(t)document.documentElement.setAttribute('data-theme',t)})();

// ── i18n ──
var currentLang='de';
var T={};
var _langCache={};

function tr(key,fallback){
  var v=T&&T[key];
  return (typeof v==='string'&&v.length)?v:(fallback!==undefined?fallback:'');
}

function _langToggleLabel(lang){
  if(lang==='de')return 'Deutsch';
  if(lang==='en')return 'English';
  if(lang==='fr')return 'Français';
  if(lang==='it')return 'Italiano';
  if(lang==='zh-cn')return '简体中文';
  return 'Espanol';
}

function _mapSupportedLang(lang){
  if(!lang)return '';
  var l=String(lang).toLowerCase().replace(/_/g,'-').trim();
  if(l==='de'||l==='en'||l==='es'||l==='fr'||l==='it'||l==='zh-cn')return l;

  var base=l.split('-')[0];
  if(base==='de'||base==='en'||base==='es'||base==='fr'||base==='it')return base;

  if(base==='zh'){
    if(l.indexOf('cn')>=0||l.indexOf('hans')>=0||l==='zh')return 'zh-cn';
  }
  return '';
}

function _normalizeLang(lang){
  return _mapSupportedLang(lang)||'de';
}

function _detectBrowserLanguage(){
  var prefs=[];
  if(Array.isArray(navigator.languages)&&navigator.languages.length)prefs=navigator.languages;
  else if(navigator.language)prefs=[navigator.language];
  for(var i=0;i<prefs.length;i++){
    var mapped=_mapSupportedLang(prefs[i]);
    if(mapped)return mapped;
  }
  return '';
}

function _resolveInitialLanguage(){
  var saved=localStorage.getItem('lang');
  var mappedSaved=_mapSupportedLang(saved);
  if(mappedSaved)return mappedSaved;
  return _detectBrowserLanguage()||'de';
}

async function _loadLanguage(lang){
  var l=_normalizeLang(lang);
  if(_langCache[l])return _langCache[l];
  var res=await fetch('/kx/ui/translations/'+l+'.json');
  if(!res.ok)throw new Error('failed to load translations: '+l);
  var data=await res.json();
  _langCache[l]=data||{};
  return _langCache[l];
}

async function setLanguage(lang){
  var l=_normalizeLang(lang);
  try{
    T=await _loadLanguage(l);
  }catch(_){
    var fb=(l==='de')?'en':'de';
    T=await _loadLanguage(fb);
    l=fb;
  }
  currentLang=l;
  localStorage.setItem('lang',l);
  var langSel=document.getElementById('lang-select');
  if(langSel)langSel.value=l;
  var sLangSel=document.getElementById('s-lang-select');
  if(sLangSel)sLangSel.value=l;
  document.documentElement.setAttribute('lang',l);
  applyLang();
}

function setLanguageFromSelect(){
  var langSel=document.getElementById('lang-select');
  var next=langSel?langSel.value:'de';
  setLanguage(next).catch(function(){});
}
// Multi-Printer: BASE_URL aus Pathname (/printer2 → andere Bridge-Instanz)
var _printers=[];
var _activePrinter=null;
(function(){
  var path=window.location.pathname.replace(/\/+$/,'');
  var m=path.match(/^\/printer(\d+)$/);
  var idx=m?parseInt(m[1]):1;
  window._printerIndex=idx;
})();
function _apiUrl(path){
  if(_activePrinter&&_activePrinter.bridge_url){
    return _activePrinter.bridge_url.replace(/\/+$/,'')+path;
  }
  return path;
}
function initPrinters(){
  fetch('/kx/printers').then(function(r){return r.json()}).then(function(d){  // immer lokale Instanz für Drucker-Liste
    _printers=d.result||[];
    var idx=window._printerIndex||1;
    _activePrinter=_printers.find(function(p){return String(p.id)===String(idx)})||_printers[0]||null;
    renderPrinterDropdown();
  }).catch(function(){});
}

// ── Header Power Switch (Issue: hard to find + poorly visible in the
// Printers tab; mirrors togglePrinterPower()/​_refreshPrinterPowerIcon() for
// the currently active printer, right next to its name/status in the header
// so it works the same in single- and multi-printer setups - switching the
// active printer via the dropdown re-evaluates has_power_control for the
// newly active one instead of a fixed dashboard card tied to whichever
// printer happened to be active on page load) ──
// Single button showing the action a click would perform (not the current
// state): printer on → button offers "Aus", printer off → button offers
// "An". _headerPowerState holds the last known actual state ('on'/'off'/
// null=unknown) so toggleHeaderPower() knows which action to send.
var _headerPowerState=null;
function _initHeaderPower(){
  var btn=document.getElementById('h-power-btn');
  if(!btn)return;
  if(!_activePrinter||!_activePrinter.has_power_control){btn.style.display='none';return;}
  btn.style.display='';
  _refreshHeaderPower();
}
function _applyHeaderPowerState(state){
  _headerPowerState=state;
  var btn=document.getElementById('h-power-btn'), lbl=document.getElementById('h-power-lbl');
  if(!btn||!lbl)return;
  // Default: show the action a click would perform (printer on -> offer
  // "Aus"). With power_status_inverted set (Settings -> Power Switch), show
  // the actual current state instead (printer on -> show "An") - some users
  // expect the button to mirror reality, not the available action.
  var inverted=!!(_activePrinter&&_activePrinter.power_status_inverted);
  var showOn=inverted?state==='on':state==='off';
  var showOff=inverted?state==='off':state==='on';
  if(showOff){
    btn.classList.remove('h-power-can-on');btn.classList.add('h-power-can-off');
    lbl.textContent=T.printers_power_off_short||'Aus';
  }else if(showOn){
    btn.classList.remove('h-power-can-off');btn.classList.add('h-power-can-on');
    lbl.textContent=T.printers_power_on_short||'An';
  }else{
    btn.classList.remove('h-power-can-on','h-power-can-off');
    lbl.textContent=T.printers_power_on_short||'An';
  }
}
function _refreshHeaderPower(){
  if(!_activePrinter||!_activePrinter.has_power_control)return;
  var bridgeUrl=(_activePrinter.bridge_url||'').replace(/\/+$/,'');
  fetch(bridgeUrl+'/kx/printers/'+encodeURIComponent(_activePrinter.id)+'/power-status',{signal:AbortSignal.timeout(5000)})
    .then(function(r){return r.json()})
    .then(function(d){_applyHeaderPowerState(d.state==='on'||d.state==='off'?d.state:null);})
    .catch(function(){/* status endpoint optional - button just stays neutral */});
}
function toggleHeaderPower(){
  if(!_activePrinter)return;
  // Unknown current state: default to "on" - turning an already-off switch
  // on is harmless, whereas guessing "off" on a printer mid-print is not.
  var action=_headerPowerState==='on'?'off':'on';
  if(action==='off'&&!confirm(T.printers_power_off_confirm||'Turn printer power off? Make sure no print is running.'))return;
  var btn=document.getElementById('h-power-btn');
  if(btn)btn.style.opacity='0.5';
  post('/kx/printers/'+encodeURIComponent(_activePrinter.id)+'/power',{action:action}).then(function(){
    if(btn)btn.style.opacity='1';
    setTimeout(_refreshHeaderPower,1500);
  }).catch(function(e){
    if(btn)btn.style.opacity='1';
    clog('Power-Fehler: '+e,'msg-err');
  });
}
function renderPrinterDropdown(){
  var wrap=document.getElementById('printer-dropdown-wrap');
  var single=document.getElementById('h-pname-single');
  var name=_printers.length===0?'–':(_activePrinter?(_activePrinter.name||'Kobra X'):'Kobra X');
  var pname=document.getElementById('h-pname');
  if(pname)pname.textContent=name;
  if(single)single.textContent=name;
  if(_printers.length>1){
    if(wrap)wrap.style.display='';
    if(single)single.style.display='none';
    var menu=document.getElementById('printer-dropdown-menu');
    if(menu){
      menu.innerHTML=_printers.map(function(p){
        var active=_activePrinter&&String(p.id)===String(_activePrinter.id);
        var num=p.id;
        return '<a href="'+((p.bridge_url||'').replace(/\/+$/,''))+'/printer'+num+'" style="display:block;padding:10px 14px;color:'+(active?'var(--accent)':'var(--txt)')+';text-decoration:none;font-size:13px;border-bottom:1px solid var(--border)" '+(active?'style="font-weight:600"':'')+'>'+
          (active?'▶ ':'')+p.name+'</a>';
      }).join('');
    }
  } else {
    if(wrap)wrap.style.display='none';
    if(single)single.style.display='';
  }
  _initHeaderPower();
}
function togglePrinterDropdown(){
  var menu=document.getElementById('printer-dropdown-menu');
  if(menu)menu.style.display=menu.style.display==='none'?'block':'none';
}
document.addEventListener('click',function(e){
  var wrap=document.getElementById('printer-dropdown-wrap');
  if(wrap&&!wrap.contains(e.target)){
    var menu=document.getElementById('printer-dropdown-menu');
    if(menu)menu.style.display='none';
  }
});
function applyLang(){
  ensureAceDryCards();
  // Nav
  var nb=document.getElementById('nb-dashboard');if(nb)nb.querySelector('.nav-text').textContent=T.nav_dashboard;
  nb=document.getElementById('nb-console');if(nb)nb.querySelector('.nav-text').textContent=T.nav_console;
  nb=document.getElementById('nb-printers');if(nb)nb.querySelector('.nav-text').textContent=T.nav_printers;
  nb=document.getElementById('nb-store');if(nb)nb.querySelector('.nav-text').textContent=T.nav_browser;
  // Bottom nav
  var bnb=document.getElementById('bnb-dashboard');if(bnb)bnb.lastChild.textContent=T.nav_dashboard;
  bnb=document.getElementById('bnb-console');if(bnb)bnb.lastChild.textContent=T.nav_console;
  bnb=document.getElementById('bnb-printers');if(bnb)bnb.lastChild.textContent=T.nav_printers;
  bnb=document.getElementById('bnb-store');if(bnb)bnb.lastChild.textContent=T.nav_browser;
  // Browser panel
  setText('printers-panel-title','🖨 '+T.nav_printers);
  setText('add-printer-btn-label',T.add_printer);
  setText('apd-title',T.add_printer);
  setText('skip-title',T.skip_title);
  setText('skip-hint',T.skip_hint);
  setText('d-btn-skip-label',T.skip_btn_label);
  setText('fd-objects-toggle-lbl',T.fd_objects_toggle);
  setText('apd-lbl-ip',T.apd_lbl_ip);
  setText('apd-lbl-name',T.apd_lbl_name);
  var apn=document.getElementById('apd-name');if(apn)apn.setAttribute('placeholder',T.apd_placeholder_name);
  setText('apd-cancel',T.apd_cancel);
  setText('apd-confirm',T.apd_confirm);
  setText('fd-slots-hint',T.fd_slots_hint);
  setText('fd-cancel',T.fd_cancel);
  setText('fd-print',T.fd_print);
  setText('store-panel-title','🗂 '+T.panel_browser_title);
  var srb=document.getElementById('store-refresh-btn');if(srb)srb.textContent=T.store_refresh;
  var ssp=document.getElementById('store-search');if(ssp)ssp.setAttribute('placeholder',T.store_search_placeholder);
  setText('store-upload-label-prefix',T.store_upload_label_prefix);
  setText('store-upload-label-browse',T.store_upload_label_browse);
  setText('store-empty',T.store_empty);
  setText('sf-all',T.sf_all);setText('sf-ok',T.sf_ok);setText('sf-err',T.sf_err);setText('sf-new',T.sf_new);
  setText('ss-date',T.ss_date);setText('ss-name',T.ss_name);setText('ss-dur',T.ss_dur);
  setText('store-web-verify-title',T.store_web_verify_title);
  setText('store-web-verify-msg',T.store_web_verify_msg);
  setText('store-web-verify-confirm',T.store_web_verify_confirm);
  setText('store-web-verify-abort',T.store_web_verify_abort);
  setText('store-lbl-select-all',T.store_select_all||'Select All');
  setText('store-lbl-delete-selected',T.store_delete_selected||'Delete Selected');
  setText('store-lbl-exit-select',T.store_exit_select||'Cancel');
  setText('btab-lbl-uploaded',T.browser_tab_uploaded||'Uploaded');
  setText('btab-lbl-printer',T.browser_tab_printer||'On Printer');
  setText('printer-store-lbl-select-all',T.store_select_all||'Select All');
  setText('printer-store-lbl-delete-selected',T.store_delete_selected||'Delete Selected');
  setText('printer-store-lbl-exit-select',T.store_exit_select||'Cancel');
  // Dashboard card titles
  setText('d-card-progress',T.card_progress);
  setText('d-card-temps',T.card_temps);
  setText('d-card-lightfan',T.card_light_fan);
  setText('d-card-speed',T.card_speed);
  setText('d-card-cam',T.card_cam);
  setText('d-card-ams',T.panel_ams_title);
  setText('d-lbl-elapsed',T.lbl_elapsed);
  setText('d-lbl-remain',T.lbl_remaining);
  setText('d-slicer-label',T.lbl_slicer_time);
  setText('d-lbl-layers',T.lbl_layers);
  setText('d-lbl-zpos',T.lbl_zpos);
  setText('d-lbl-light',T.lbl_light);
  setText('d-lbl-nozzle',T.label_nozzle);
  setText('d-lbl-bed',T.label_bed);
  // Dashboard buttons — Pause-Button wird zur Toggle-Action; Resume-Beschriftung
  // wird in updatePauseResumeBtn() je nach Druckerzustand gesetzt.
  updatePauseResumeBtn();
  setText('d-btn-cancel',T.btn_cancel);
  setText('cam-toggle-btn',camOn?T.btn_cam_stop:T.btn_cam_start);
  setText('cam-placeholder-txt',T.cam_placeholder);
  // Temp labels
  document.querySelectorAll('.lbl-set').forEach(e=>e.textContent=T.label_set);
  document.querySelectorAll('.lbl-off').forEach(e=>e.textContent=T.label_off);
  setText('d-chart-label',T.panel_temps_chart);
  // Axis labels
  setText('ptitle-motion-xy',T.panel_motion_xy);
  document.querySelectorAll('.lbl-home-z').forEach(e=>e.textContent=T.btn_home_z);
  document.querySelectorAll('.lbl-home-xy').forEach(e=>e.textContent=T.btn_home_xy);
  document.querySelectorAll('.lbl-home-all').forEach(e=>e.textContent=T.btn_home_all);
  document.querySelectorAll('.lbl-disable-motors').forEach(e=>e.textContent=T.btn_disable_motors);
  document.querySelectorAll('.temp-input').forEach(e=>e.setAttribute('placeholder',T.label_target_c.replace(':','')));
  // Console
  setText('ptitle-console',T.panel_console_title);
  // Settings-Panel
  setText('modal-sec-connection',T.settings_connection);
  setText('modal-sec-print',T.settings_print);
  setText('modal-sec-version',T.settings_version);
  // Nav + Kategorie-Labels (mit Fallback falls i18n-Key noch fehlt)
  setText('nav-settings',T.nav_settings||'Einstellungen');
  setText('setcat-lbl-connection',T.settings_connection||'Verbindung');
  setText('setcat-lbl-printer',T.settings_print||'Drucker');
  setText('setcat-lbl-display',T.settings_cat_display||'Darstellung');
  setText('setcat-lbl-display2',T.settings_cat_display||'Darstellung');
  setText('setcat-lbl-filament',T.settings_cat_filament||'Filament');
  setText('setcat-lbl-integrations',T.settings_integrations||'Integrationen');
  setText('modal-sec-spoolman',T.modal_sec_spoolman||'Spoolman');
  setText('lbl-spoolman-url',T.lbl_spoolman_url||'Server-URL');
  setText('lbl-spoolman-sync-rate',T.lbl_spoolman_sync_rate||'Sync-Rate (s, 0=aus)');
  setText('modal-sec-obico',T.modal_sec_obico||'Obico');
  setText('setcat-lbl-system',T.settings_version||'System');
  setText('lbl-set-lang',T.settings_cat_language||'Sprache');
  setText('lbl-set-theme',T.settings_cat_theme||'Hell / Dunkel umschalten');
  setText('lbl-poll-interval',T.settings_poll||'Poll-Intervall (Sekunden)');
  setText('lbl-verbose-http-log',T.settings_verbose_http_log||'Log every HTTP request (verbose)');
  var dashLbl=document.getElementById('dash-lbl-edit');
  if(dashLbl)dashLbl.textContent=_dashEditing?(T.dash_done||'Done'):(T.dash_edit||'Customize dashboard');
  setText('dash-lbl-reset',T.dash_reset||'Reset');
  setText('dash-lbl-save-preset',T.dash_save_preset||'Save as preset');
  var dashPresetStd=document.getElementById('dash-preset-standard');
  if(dashPresetStd)dashPresetStd.textContent=T.dash_preset_standard||'Standard';
  var dashPresetWide=document.getElementById('dash-preset-wide89');
  if(dashPresetWide)dashPresetWide.textContent=T.dash_preset_wide89||'Wide desktop';
  if(document.getElementById('dash-hidden-bar'))_dashRenderHiddenBar();
  setText('lbl-filament-mapping',T.settings_filament_mapping||'Filament-Profil-Mapping (pro Slot)');
  setText('lbl-filament-mapping-save',T.settings_filament_mapping_save||'Mapping speichern');
  setText('lbl-visible-vendors',T.settings_visible_vendors||'Sichtbare Hersteller (Profil-Dropdown)');
  setText('visible-vendors-hint',T.settings_visible_vendors_hint||'Nur diese Hersteller erscheinen im Slot-Profil-Dropdown. Nichts ausgewählt = alle anzeigen. „Generic" und eigene Profile sind immer sichtbar.');
  setText('lbl-visible-vendors-save',T.settings_visible_vendors_save||'Auswahl speichern');
  // Custom-Profile-Import (Issue #41)
  setText('modal-sec-orca-profiles',T.orca_profile_section);
  setText('orca-profiles-hint',T.orca_profile_hint);
  setText('lbl-orca-profiles-import',T.orca_profile_import_btn);
  setText('lbl-slot-profile-import',T.orca_profile_import_link);
  setText('profile-import-title',T.orca_profile_import_title);
  setText('profile-import-dropmsg',T.orca_profile_dropmsg);
  setText('profile-import-list-label',T.orca_profile_list_label);
  // Hilfe-Text mit Inline-HTML — innerHTML statt setText
  var helpEl=document.getElementById('profile-import-help');
  if(helpEl && T.orca_profile_help_html) helpEl.innerHTML=T.orca_profile_help_html;
  setText('btn-save-settings',T.settings_save);
  setText('lbl-printer-name',T.settings_printer_name);
  setText('lbl-printer-ip',T.settings_printer_ip);
  setText('lbl-mqtt-port',T.settings_mqtt_port);
  setText('lbl-username',T.settings_username);
  setText('lbl-password',T.settings_password);
  setText('lbl-device-id',T.settings_device_id);
  setText('lbl-mode-id',T.settings_mode_id);
  setText('modal-sec-power',T.settings_power||'Power Switch');
  setText('lbl-power-on-url',T.settings_power_on_url||'Power-On URL');
  setText('lbl-power-off-url',T.settings_power_off_url||'Power-Off URL');
  setText('lbl-power-status-url',T.settings_power_status_url||'Status URL');
  setText('lbl-power-hint',T.settings_power_hint||'Optional: plain HTTP GET URLs for a smart plug (e.g. Tasmota) controlling the printer\'s mains power. Leave empty to hide the power button.');
  setText('lbl-power-status-inverted',T.settings_power_status_inverted||'Show current status instead of action');
  setText('lbl-default-slot',T.settings_default_slot);
  setText('opt-slot-auto',T.settings_slot_auto);
  setText('lbl-auto-leveling',T.settings_auto_leveling);
  setText('lbl-vibration-compensation',T.settings_vibration_compensation);
  setText('lbl-file-ready-mode',T.settings_file_ready_mode);
  setText('opt-file-ready-dialog',T.settings_file_ready_dialog);
  setText('opt-file-ready-banner',T.settings_file_ready_banner);
  setText('lbl-camera-on-print',T.settings_camera_on_print);
  setText('lbl-web-upload-warning',T.settings_web_upload_warning);
  setText('lbl-delete-printer-file-after-print',T.settings_delete_printer_file_after_print||'Delete file from printer after successful print');
  setText('lbl-delete-printer-file-after-print-hint',T.settings_delete_printer_file_after_print_hint||'Only applies to prints started through this bridge (files it uploaded itself) - prints started directly from the printer or Anycubic Slicer are never deleted, since no copy of those exists anywhere else.');
  setText('fd-options-title',T.fd_options_title);
  setText('fd-lbl-auto-leveling',T.print_auto_leveling);

  setText('lbl-update-check',T.update_check);
  setText('lbl-update-apply',T.update_apply);
  // Progress-Karten-Aktionen für geladene/idle Datei (Issue #55)
  setText('d-idle-print-lbl',T.progress_action_print||'Drucken');
  setText('d-idle-slots-lbl',T.progress_action_slots||'Slots zuordnen');
  setText('d-idle-clear-lbl',T.progress_action_clear||'Leeren');
  // Speed buttons
  setText('d-spd-lbl-1',T.speed_silent.replace(/^\S+\s/,''));
  setText('d-spd-lbl-2',T.speed_normal.replace(/^\S+\s/,''));
  setText('d-spd-lbl-3',T.speed_sport.replace(/^\S+\s/,''));
  // AMS feed/unload
  document.querySelectorAll('.lbl-feed').forEach(e=>e.textContent=T.lbl_feed);
  document.querySelectorAll('.lbl-unload').forEach(e=>e.textContent=T.lbl_unload);
  for(var i=0;i<4;i++){
      setText('d-card-ace-dry-'+i,'ACE '+(i+1)+' - '+tr('ace_dry_dryer'));
      setText('d-ace-auto-refill-label-'+i,tr('ace_dry_auto_refill'));
      setText('d-ace-drying-enable-label-'+i,tr('ace_dry_enable'));
      setText('d-ace-dry-humidity-label-'+i,tr('ace_dry_humidity')+':');
      setText('d-ace-dry-current-temp-label-'+i,tr('ace_dry_current_temp')+':');
      setText('d-ace-dry-target-label-'+i,tr('ace_dry_temp_line')+':');
      setText('d-ace-dry-time-label-'+i,tr('ace_dry_time_line')+':');
      setText('d-ace-dry-chart-label-'+i,tr('ace_dry_chart'));
    var adTemp=document.getElementById('ace-dry-temp-'+i);if(adTemp)adTemp.setAttribute('placeholder',T.ace_dry_temp);
    var adDur=document.getElementById('ace-dry-duration-'+i);if(adDur)adDur.setAttribute('placeholder',T.ace_dry_duration);
  }
  setText('ace-dry-dialog-title',tr('ace_dry_dialog_title'));
  setText('ace-dry-dialog-temp-label',tr('ace_dry_dialog_temp'));
  setText('ace-dry-dialog-time-label',tr('ace_dry_dialog_time'));
  setText('ace-dry-dialog-custom-name-label',tr('ace_dry_dialog_custom_name'));
  setText('ace-dry-dialog-cancel',tr('ace_dry_dialog_cancel'));
  setText('ace-dry-dialog-confirm',tr('ace_dry_dialog_confirm'));
  setText('ace-dry-dialog-reset-default',tr('ace_dry_dialog_reset_default'));
  setText('ace-dry-dialog-save-preset',tr('ace_dry_dialog_save_restart'));
  aceDryDialogSyncCustomButtonNames();
  // conn-btn text (nur wenn nicht im Übergangszustand)
  updateConnBtn();
  // Slot-Edit-Dialog
  setText('lbl-slot-color',T.slot_edit_color);
  setText('lbl-slot-material',T.slot_edit_material);
  setText('lbl-slot-profile',T.slot_edit_profile);
  setText('slot-profile-hint',T.slot_edit_profile_hint);
  var defOpt=document.getElementById('slot-profile-default-opt');
  if(defOpt) defOpt.textContent=T.slot_edit_profile_default;
  setText('btn-slot-edit-save',T.slot_edit_save);
  updateSlotEditFeedButton();
  var mi=document.getElementById('slot-edit-mat');if(mi)mi.setAttribute('placeholder',T.slot_edit_custom);
  setText('logdir-all',T.log_dir_all);
  setText('loglvl-all',T.log_dir_all);
  setText('log-lbl-level',T.log_lvl_label);
  setText('file-ready-btn',T.file_ready_btn);
  setText('file-slots-btn',T.file_slots_btn);
  setText('file-cancel-btn',T.file_cancel_btn);
  // GCode-Browser-Karten: Texte sind via innerHTML eingebacken,
  // bei Sprachwechsel komplett neu rendern.
  if(typeof renderStore==='function' && typeof storeFiles!=='undefined'){
    try{ renderStore(); }catch(e){}
  }
}
function setText(id,txt){var el=document.getElementById(id);if(el)el.textContent=txt;}

function ensureAceDryCards(){
  var grid=document.getElementById('d-ace-dry-grid');
  if(!grid||grid.getAttribute('data-init')==='1')return;
  var html='';
  for(var i=0;i<4;i++){
    html+='<div class="card" id="d-ace-dry-card-'+i+'" style="display:none">'
      +'<div class="card-title"><span>♨</span> <span id="d-card-ace-dry-'+i+'">ACE '+(i+1)+' - Dryer</span></div>'
      +'<div style="display:flex;justify-content:space-between;gap:10px;font-size:14px;color:var(--txt2);margin-bottom:10px">'
        +'<span><span id="d-ace-dry-current-temp-label-'+i+'">Temperature:</span> <span id="d-ace-dry-current-temp-'+i+'" style="font-size:30px;font-weight:700;color:#ff8c2f;line-height:1">-</span></span>'
        +'<span><span id="d-ace-dry-humidity-label-'+i+'">Humidity:</span> <span id="d-ace-dry-humidity-'+i+'" style="font-size:30px;font-weight:700;color:#3aa8ff;line-height:1">-</span></span>'
      +'</div>'
      +'<div style="height:1px;background:var(--border);margin-bottom:10px"></div>'
      +'<div style="display:flex;justify-content:space-between;gap:10px;font-size:14px;color:var(--txt2);margin-bottom:10px">'
        +'<span><span id="d-ace-dry-target-label-'+i+'">Drying Temperature:</span> <span id="d-ace-dry-target-'+i+'" style="font-size:30px;font-weight:700;color:#ff8c2f;line-height:1">-</span></span>'
        +'<span><span id="d-ace-dry-time-label-'+i+'">Drying Time:</span> <span id="d-ace-dry-time-'+i+'" style="font-size:30px;font-weight:700;color:#fff;line-height:1">-</span></span>'
      +'</div>'
      +'<div style="margin-bottom:10px">'
        +'<button onclick="openAceDryDialog('+i+')" title="Edit Dryer Temp/Time Settings" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--accent);background:var(--accent);color:#000;cursor:pointer;font-size:13px;font-weight:600;line-height:1.2">Set Temp/Time</button>'
      +'</div>'
      +'<div style="height:1px;background:var(--border);margin-bottom:10px"></div>'
      +'<div class="toggle-row" style="margin-bottom:10px">'
        +'<span class="toggle-label" id="d-ace-auto-refill-label-'+i+'">Auto Refill</span>'
        +'<label class="toggle">'
          +'<input type="checkbox" id="ace-auto-refill-toggle-'+i+'" onchange="aceAutoRefillToggle('+i+')">'
          +'<span class="toggle-track"></span>'
          +'<span class="toggle-thumb"></span>'
        +'</label>'
      +'</div>'
      +'<div class="toggle-row" style="margin-bottom:8px">'
        +'<span class="toggle-label" id="d-ace-drying-enable-label-'+i+'">Enable Drying</span>'
        +'<label class="toggle">'
          +'<input type="checkbox" id="ace-dry-enable-toggle-'+i+'" onchange="aceDryToggle('+i+',this.checked)">'
          +'<span class="toggle-track"></span>'
          +'<span class="toggle-thumb"></span>'
        +'</label>'
      +'</div>'
      +'</div>';
  }
  grid.innerHTML=html;
  grid.setAttribute('data-init','1');
}
(function(){
  var l=_resolveInitialLanguage();
  currentLang=_normalizeLang(l);
  var langSel=document.getElementById('lang-select');
  if(langSel)langSel.value=currentLang;
  document.documentElement.setAttribute('lang',currentLang);
  // defer until DOM ready
  window.addEventListener('DOMContentLoaded',function(){
    setLanguage(currentLang).catch(function(){});
    _loadSpoolmanStatus();
    // Kein Drucker konfiguriert? → direkt in den Drucker-Tab (zeigt "+ Drucker hinzufügen")
    fetch('/kx/printers').then(function(r){return r.json()}).then(function(d){
      if(!d.result||!d.result.length){showPanel('printers');loadPrinterTab();}
    }).catch(function(){});
  });
})();

// ── Panel nav ──
function showPanel(id){
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  document.getElementById('panel-'+id).classList.add('active');
  document.querySelectorAll('.nav-btn,.bnav-btn').forEach(b=>b.classList.remove('active'));
  var nb=document.getElementById('nb-'+id);if(nb)nb.classList.add('active');
  var bnb=document.getElementById('bnb-'+id);if(bnb)bnb.classList.add('active');
  currentPanel=id;
  if(id==='settings')openSettings();
}

// Settings-Kategorie umschalten (Master-Detail)
function showSettingsCat(name){
  document.querySelectorAll('.set-group').forEach(g=>g.classList.remove('active'));
  document.querySelectorAll('.set-cat').forEach(b=>b.classList.remove('active'));
  var g=document.getElementById('setgrp-'+name);if(g)g.classList.add('active');
  var c=document.getElementById('setcat-'+name);if(c)c.classList.add('active');
}

// Browser-Sub-Tab umschalten: hochgeladene Dateien (Bridge-Store) vs. Dateien
// auf dem Drucker selbst (interner Speicher, via listLocal MQTT).
var _printerFilesLoaded=false;
function showBrowserTab(name){
  document.querySelectorAll('.browser-group').forEach(g=>g.classList.remove('active'));
  document.querySelectorAll('.browser-tab').forEach(b=>b.classList.remove('active'));
  var g=document.getElementById('browser-group-'+name);if(g)g.classList.add('active');
  var t=document.getElementById('btab-'+name);if(t)t.classList.add('active');
  if(name==='printer'&&!_printerFilesLoaded)loadPrinterFiles();
}

// ── Console log ──
var consoleLogs=[];
var logAutoScroll=true;
var logBadgeCount=0;
var logDirFilter='all';   // 'all'|'rx'|'tx'
var logLevelFilter='all'; // 'all'|'err'|'warn'
var logTopicFilter='';    // '' = no topic filter

function clog(msg,cls){
  cls=cls||'msg-info';
  var ts=new Date().toLocaleTimeString('de',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  _appendLog({ts:ts,lvl:'',name:'ui',msg:msg},cls);
}
function _lvlCls(lvl){
  if(lvl==='ERROR'||lvl==='CRITICAL')return'msg-err';
  if(lvl==='WARNING')return'msg-warn';
  if(lvl==='DEBUG')return'msg-info';
  return'msg-ok';
}
function _appendLog(entry,forceCls){
  var cls=forceCls||_lvlCls(entry.lvl);
  var label=entry.name?'['+entry.name+'] ':'';
  var fullMsg=label+entry.msg;
  // Wiederholungen als Zähler zusammenfassen (×N) statt N identische Zeilen.
  var last=consoleLogs[consoleLogs.length-1];
  if(last&&last.msg===fullMsg&&last.cls===cls){
    last.count=(last.count||1)+1;
    last.ts=entry.ts; // letzte Sichtung
    renderLog();
    return;
  }
  consoleLogs.push({ts:entry.ts,msg:fullMsg,cls:cls,count:1});
  if(consoleLogs.length>500)consoleLogs.shift();
  // Badge + Toast wenn Tab nicht aktiv und Fehler/Warnungen
  if(currentPanel!=='console'&&(cls==='msg-err'||cls==='msg-warn')){
    logBadgeCount++;
    var bc=logBadgeCount>99?'99+':logBadgeCount;
    ['log-badge','log-badge-bot'].forEach(function(id){var b=document.getElementById(id);if(b){b.style.display='inline';b.textContent=bc;}});
  }
  if(cls==='msg-err')showToast(entry.msg.split('\n')[0]);
  renderLog();
}
// Kurze rote Snackbar bei Fehlern (auch wenn Konsole-Tab nicht offen).
var _toastTimer=null;
function showToast(msg){
  var t=document.getElementById('kx-toast');
  if(!t){
    t=document.createElement('div'); t.id='kx-toast';
    t.style.cssText='position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--err);color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;z-index:9999;max-width:90vw;box-shadow:0 4px 16px rgba(0,0,0,.4);cursor:pointer';
    t.onclick=function(){showPanel('console');t.style.display='none';};
    document.body.appendChild(t);
  }
  t.textContent='⚠ '+msg;
  t.style.display='block';
  clearTimeout(_toastTimer);
  _toastTimer=setTimeout(function(){t.style.display='none';},6000);
}
function setLogDir(dir){
  logDirFilter=dir;
  document.querySelectorAll('.log-dir-btn').forEach(function(b){
    b.style.background=b.id==='logdir-'+dir?'var(--accent)':'var(--raised)';
    b.style.color=b.id==='logdir-'+dir?'#fff':'var(--txt2)';
  });
  renderLog();
}
function setLogLevel(lvl){
  logLevelFilter=lvl;
  document.querySelectorAll('.log-lvl-btn').forEach(function(b){
    b.style.background=b.id==='loglvl-'+lvl?'var(--accent)':'var(--raised)';
    b.style.color=b.id==='loglvl-'+lvl?'#fff':'var(--txt2)';
  });
  renderLog();
}
function setLogTopic(topic){
  var inp=document.getElementById('log-filter');
  var active=inp.value===topic;
  inp.value=active?'':topic;
  document.querySelectorAll('.log-topic-btn').forEach(function(b){
    var on=!active&&b.getAttribute('data-topic')===topic;
    b.style.background=on?'var(--accent)':'var(--raised)';
    b.style.color=on?'#fff':'var(--txt2)';
  });
  renderLog();
}
function renderLog(){
  var el=document.getElementById('console-log');
  if(!el)return;
  var filter=(document.getElementById('log-filter')||{}).value||'';
  var fl=filter.toLowerCase();
  var rows=consoleLogs.filter(function(l){
    var m=l.msg;
    if(logDirFilter==='rx'&&!/ RX[ (]/.test(m))return false;
    if(logDirFilter==='tx'&&!/ TX[ (]/.test(m))return false;
    if(logLevelFilter==='err'&&l.cls!=='msg-err')return false;
    if(logLevelFilter==='warn'&&l.cls!=='msg-err'&&l.cls!=='msg-warn')return false;
    if(fl&&!m.toLowerCase().includes(fl))return false;
    return true;
  });
  var savedScroll=logAutoScroll?null:el.scrollTop;
  el.innerHTML=rows.map(function(l){
    var cnt=(l.count&&l.count>1)?' <span style="opacity:.7">(×'+l.count+')</span>':'';
    return '<div><span class="ts">'+l.ts+'</span><span class="'+l.cls+'">'+escHtml(l.msg)+'</span>'+cnt+'</div>';
  }).join('');
  if(logAutoScroll)el.scrollTop=el.scrollHeight;
  else if(savedScroll!==null)el.scrollTop=savedScroll;
}
function onLogScroll(){
  var el=document.getElementById('console-log');
  if(!el)return;
  var atBottom=el.scrollHeight-el.scrollTop-el.clientHeight<30;
  if(!atBottom&&logAutoScroll){setAutoScroll(false);}
}
function toggleAutoScroll(){
  setAutoScroll(!logAutoScroll);
  if(logAutoScroll){var el=document.getElementById('console-log');if(el)el.scrollTop=el.scrollHeight;}
}
function setAutoScroll(on){
  logAutoScroll=on;
  var btn=document.getElementById('btn-autoscroll');
  if(btn){btn.style.background=on?'var(--accent)':'var(--raised)';btn.style.color=on?'#fff':'var(--txt2)';}
}
function clearLogBadge(){
  logBadgeCount=0;
  ['log-badge','log-badge-bot'].forEach(function(id){var b=document.getElementById(id);if(b)b.style.display='none';});
}
function escHtml(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
// SSE server-log stream
(function(){
  function connect(){
    var es=new EventSource('/api/log/stream');
    es.onmessage=function(e){try{_appendLog(JSON.parse(e.data));}catch(_){}};
    es.onerror=function(){es.close();setTimeout(connect,3000);};
  }
  window.addEventListener('DOMContentLoaded',connect);
})();

// ── Helpers ──
function fmtTime(s){if(!s||s<0)return'–';var m=Math.floor(s/60),h=Math.floor(m/60);m%=60;return h>0?h+'h '+m+'m':m+'m'}
function fmtHmsFromSec(total){
  total=Math.max(0,parseInt(total||0,10));
  var h=Math.floor(total/3600);
  var mm=Math.floor((total%3600)/60);
  var ss=total%60;
  return h+':'+String(mm).padStart(2,'0')+':'+String(ss).padStart(2,'0');
}
function post(url,body){return fetch(_apiUrl(url),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})}
function clamp(v,lo,hi){return Math.min(hi,Math.max(lo,v))}

// ── Apply state to DOM ──
function applyState(){
  var s=S;
  _syncAceDryPresetsFromServer(s.ace_dry_presets);
  // connection error banner – nur wenn überhaupt ein Drucker konfiguriert ist
  var banner=document.getElementById('conn-error-banner');
  if(banner){if(s.connection_error&&_printers.length>0){banner.textContent='⚠ '+tr('lbl_conn_error')+' '+s.connection_error;banner.style.display='block';}else{banner.style.display='none';}}
  var pauseBanner=document.getElementById('pause-msg-banner');
  if(pauseBanner){
    if(s.pause_msg && s.print_state==='paused'){
      var codePart = (s.error_code==0) ? ' ' :
        ' [<a href="https://wiki.anycubic.com/en/error-codes/'+s.error_code+'-code" target="_blank">'+s.error_code+'</a>] ';
      pauseBanner.innerHTML='⏸ '+tr('lbl_pause_reason')+codePart+s.pause_msg;
      pauseBanner.style.display='block';
    }else{
      pauseBanner.style.display='none';
    }
  }
  var bannerVisible=false;
  var frb=document.getElementById('file-ready-banner');
  if(frb){
    var shouldAutoOpen=(s.print_start_dialog===undefined?true:!!s.print_start_dialog);
    if(s.file_ready&&s.print_state==='standby'){
      document.getElementById('file-ready-name').textContent=s.file_ready;
      // Neue Datei → Abbruch-Sperre aufheben
      if(_fdAutoOpenedFile&&_fdAutoOpenedFile!==s.file_ready){
        _fdUserCancelled=false;
        sessionStorage.removeItem('fdUserCancelled');
        sessionStorage.removeItem('fdAutoOpenedFile');
      }
      if(shouldAutoOpen){
        // Dialog-Modus: Banner niemals anzeigen.
        frb.style.display='none';
        if(!_fdDialogOpen&&!_fdUserCancelled&&_fdAutoOpenedFile!==s.file_ready){
          _fdAutoOpenedFile=s.file_ready;
          startReadyFileWithSlots(s.file_ready,true,s.filament_mismatch||null);
        }
      } else {
        frb.style.display='flex';
        bannerVisible=true;
      }
    }else{frb.style.display='none';}
  }
  // skip-button (mid-print) – nur sichtbar wenn aktuell gedruckt wird
  var printing=(s.print_state==='printing'||s.print_state==='paused');
  var skipBtn=document.getElementById('d-btn-skip');
  if(skipBtn) skipBtn.style.display=printing?'':'none';
  // Pause/Stopp-Buttons nur bei aktivem Druck zeigen (sonst verwirrend wenn
  // der Drucker idle ist). Pause-Button rendert sich passend zum State um.
  var ctrlBtns=document.getElementById('d-ctrl-btns');
  if(ctrlBtns) ctrlBtns.style.display=printing?'':'none';
  updatePauseResumeBtn();
  // Zuletzt geladene Datei merken (Issue #55): solange sie über den State
  // sichtbar ist. Beim Druckende/Abbruch leert die Bridge file_ready+filename
  // (Issue #29) — die gemerkte Referenz bleibt für die Karten-Aktionen.
  // Echte ready-Datei oder laufender Druck hebt einen vorherigen „Clear" auf.
  if(s.file_ready||printing) _idleCleared=false;
  if(s.file_ready) _lastLoadedFile=s.file_ready;
  else if(s.filename && !_idleCleared) _lastLoadedFile=s.filename;
  else if(_idleCleared) _lastLoadedFile=null;
  // Idle-Aktionen (Drucken/Slots/Leeren) nur wenn nicht gedruckt wird, eine
  // Datei bekannt ist und der grüne Banner nicht ohnehin schon dieselbe Aktion
  // anbietet.
  var idleBtns=document.getElementById('d-idle-btns');
  if(idleBtns){
    var showIdle=(!printing && _lastLoadedFile && !bannerVisible);
    idleBtns.style.display=showIdle?'':'none';
    if(showIdle){
      var dfn=document.getElementById('d-fname');
      if(dfn && (!dfn.textContent || dfn.textContent==='–')){
        dfn.textContent=_lastLoadedFile;dfn.title=_lastLoadedFile;
      }
    }
  }

  // header
  var b=document.getElementById('h-badge');
  b.className='hbadge '+s.print_state;
  document.getElementById('h-state').textContent=T['kobra_'+s.kobra_state]||s.kobra_state||T.header_status_standby;
  var _pn=_printers.length===0?'–':((_activePrinter&&_activePrinter.name)||s.printer_name);
  var _el=document.getElementById('h-pname');if(_el)_el.textContent=_pn;
  var _el2=document.getElementById('h-pname-single');if(_el2)_el2.textContent=_pn;
  var hv=document.getElementById('h-version');if(hv&&s.version)hv.textContent='v'+s.version;


  // temps
  var nt=document.getElementById('d-nt');if(nt)nt.textContent=s.nozzle_temp.toFixed(1);
  var ntt=document.getElementById('d-nt-t');if(ntt)ntt.textContent=s.nozzle_target.toFixed(0);
  var bt=document.getElementById('d-bt');if(bt)bt.textContent=s.bed_temp.toFixed(1);
  var btt=document.getElementById('d-bt-t');if(btt)btt.textContent=s.bed_target.toFixed(0);

  // temp bars (dashboard)
  var nb=document.getElementById('d-ntbar');if(nb)nb.style.width=clamp(s.nozzle_temp/300*100,0,100)+'%';
  var bb=document.getElementById('d-btbar');if(bb)bb.style.width=clamp(s.bed_temp/120*100,0,100)+'%';

  // progress
  var pct=Math.round(s.progress*100);
  var dpct=document.getElementById('d-pct');if(dpct)dpct.textContent=pct;
  var dpbar=document.getElementById('d-pbar');if(dpbar)dpbar.style.width=pct+'%';

  var layers=s.curr_layer&&s.total_layers?'L '+s.curr_layer+' / '+s.total_layers:'–';
  var dlayers=document.getElementById('d-layers');if(dlayers)dlayers.textContent=layers;
  var dzpos=document.getElementById('d-zpos');if(dzpos)dzpos.textContent=s.z_mm>0?s.z_mm.toFixed(2)+' mm':'–';

  var delapsed=document.getElementById('d-elapsed');if(delapsed)delapsed.textContent=fmtTime(s.print_duration);
  var dremain=document.getElementById('d-remain');if(dremain)dremain.textContent=s.remain_time>0?fmtTime(s.remain_time):'–';
  var dslrow=document.getElementById('d-slicer-row');
  var dsltime=document.getElementById('d-slicer-time');
  if(dslrow&&dsltime){
    if(s.slicer_time>0){dslrow.style.display='';dsltime.textContent=fmtTime(s.slicer_time);}
    else{dslrow.style.display='none';}
  }

  var fn=s.filename||'–';
  var dfname=document.getElementById('d-fname');if(dfname){dfname.textContent=fn;dfname.title=fn};
  var pfname=document.getElementById('p-fname');if(pfname){pfname.textContent=fn;pfname.title=fn};
  var cfo=document.getElementById('cam-fname');if(cfo)cfo.textContent=fn!=='–'?fn:'';

  // thumbnail
  var thumb=document.getElementById('d-thumbnail');
  if(thumb){
    if(s.thumbnail){
      thumb.src='data:image/png;base64,'+s.thumbnail;
      thumb.style.display='block';
    } else {
      thumb.style.display='none';
      thumb.src='';
    }
  }

  // light/fan sync
  document.getElementById('d-light-toggle').checked=s.light_on;
  var dfan=document.getElementById('d-fan');if(dfan)dfan.value=s.fan_speed;
  var dfanval=document.getElementById('d-fan-val');if(dfanval)dfanval.textContent=s.fan_speed;

  // speed mode buttons
  var spdWidths={1:25,2:55,3:90};
  [1,2,3].forEach(function(m){
    var b=document.getElementById('d-spd-'+m);
    if(b) b.classList.toggle('spd-active', s.print_speed_mode===m);
  });
  var spdBar=document.getElementById('d-spd-bar');
  if(spdBar) spdBar.style.width=(spdWidths[s.print_speed_mode]||55)+'%';

  var amsTitle=document.getElementById('d-card-ams');
  if(amsTitle){
    var baseTitle=tr('card_ams');
    var modeMap={toolhead:'Toolhead',ace_direct:'ACE Direct',ace_hub:'ACE Hub'};
    var modeTxt=modeMap[s.filament_mode]||'';
    amsTitle.textContent=modeTxt?(baseTitle+' - '+modeTxt):baseTitle;
  }

  ensureAceDryCards();
  var dry=s.ace_drying||{status:0,target_temp:0,duration:0,remain_time:0,humidity:null,current_temp:null,units:[]};
  var units=(dry.units||[]);
  var unitMap={};
  units.forEach(function(u){var id=Number(u.id);if(id>=0&&id<=3)unitMap[id]=u;});
  var aceMode=s.filament_mode==='ace_direct'||s.filament_mode==='ace_hub';
  var detected=(s.ace_units||[]).filter(function(id){return id>=0&&id<=3;});
  if(!detected.length){
    Object.keys(unitMap).forEach(function(k){detected.push(Number(k));});
  }
  if(!detected.length){
    (s.ams_slots||[]).forEach(function(sl){var id=Number(sl.box_id);if(id>=0&&id<=3&&detected.indexOf(id)<0)detected.push(id);});
  }
  detected.sort(function(a,b){return a-b;});
  var aceWrap=document.getElementById('d-ace-dry-wrap');
  if(aceWrap)aceWrap.style.display=(aceMode&&detected.length)?'contents':'none';
  for(var i=0;i<4;i++){
    var card=document.getElementById('d-ace-dry-card-'+i);
    if(!card)continue;
    var show=aceMode&&detected.indexOf(i)>=0;
    card.style.display=show?'':'none';
    if(!show)continue;
    var ud=unitMap[i]||dry;
    var refillToggle=document.getElementById('ace-auto-refill-toggle-'+i);
    var autoFeedMap=s.ace_auto_feed||{};
    if(refillToggle&&!_aceAutoFeedPending[i]){
      var afVal=autoFeedMap.hasOwnProperty(String(i))?Number(autoFeedMap[String(i)]):(_aceAutoRefillGet(i)?1:0);
      refillToggle.checked=afVal===1;
    }
    var dryToggle=document.getElementById('ace-dry-enable-toggle-'+i);
    if(dryToggle)dryToggle.checked=Number(ud.status||0)>0;
    var hh=document.getElementById('d-ace-dry-humidity-'+i);
    if(hh){
      var hv=(ud.humidity===null||ud.humidity===undefined||ud.humidity==='')?null:Number(ud.humidity);
      hh.textContent=(hv===null||Number.isNaN(hv))?'-':(Math.round(hv)+'%');
    }
    var ht=document.getElementById('d-ace-dry-current-temp-'+i);
    if(ht){
      var ct=(ud.current_temp===null||ud.current_temp===undefined||ud.current_temp==='')?null:Number(ud.current_temp);
      ht.textContent=(ct===null||Number.isNaN(ct))?'-':(ct.toFixed(1)+'°C');
    }
    var prof=_aceDryProfileGet(i);
    var useSec=(Number(ud.status||0)>0&&Number(ud.remain_time)>0)
      ?Number(ud.remain_time||0)*60
      :prof.duration_sec;
    var showTemp=(Number(ud.status||0)>0&&Number(ud.target_temp)>0)?Number(ud.target_temp):prof.temp;
    var dryTempEl=document.getElementById('d-ace-dry-target-'+i);
    if(dryTempEl)dryTempEl.textContent=showTemp+'°C';
    var dryTimeEl=document.getElementById('d-ace-dry-time-'+i);
    if(dryTimeEl)dryTimeEl.textContent=fmtHmsFromSec(useSec);
  }

  // AMS
  if(s.ams_slots&&s.ams_slots.length){
    window._amsSlots=s.ams_slots;
    // Group by box_id (-1=Toolhead, 0=ACE 1, 1=ACE 2, ...)
    var boxMap={};
    s.ams_slots.forEach(function(slot,i){
      var bid=slot.box_id!=null?slot.box_id:-1;
      if(!boxMap[bid])boxMap[bid]=[];
      boxMap[bid].push({slot:slot,arrIdx:i});
    });
    var boxIds=Object.keys(boxMap).map(Number).sort(function(a,b){return a-b});
    var acePresent=boxIds.some(function(b){return b>=0;});
    var html='';
    boxIds.forEach(function(bid){
      var entries=boxMap[bid];
      var label=bid===-1
        ?(acePresent?'Toolhead (Slots 1–3)':'Toolhead')
        :('ACE '+(bid+1));
      html+='<div class="ams-box-group">'
        +'<div class="ams-box-label">'+label+'</div>'
        +'<div class="ams-box-slots">';
      entries.forEach(function(e){
        var slot=e.slot;var i=e.arrIdx;
        var empty=slot.status!==5;
        var rgb=empty?[80,80,80]:(Array.isArray(slot.color)?slot.color:[128,128,128]);
        var col='rgb('+rgb[0]+','+rgb[1]+','+rgb[2]+')';
        var globalIdx=slot.global_index!=null?slot.global_index:i;
        var active=slot.status===1||slot.active;
        var loaded=(s.ams_loaded_slot!=null&&s.ams_loaded_slot>=0&&globalIdx===s.ams_loaded_slot);
        var activity=(slot.activity||'');
        var pct=empty?T.ams_empty:(slot.consumables_percent!=null?slot.consumables_percent+'%':'–');
        var slotLabel=T.label_slot+' '+(globalIdx+1);
        // Gemapptes Profil nur für belegte Slots verwenden — sonst zeigt ein
        // verwaistes Mapping (Slot wurde geleert) ein „Geister"-Profil (Issue #57).
        var profile=empty?null:(window._slotProfileMap||{})[globalIdx];
        var genericType=(slot.type||slot.material_type||'–');
        // Material-Label: bei belegtem Slot mit Mapping den konkreten Profilnamen
        // (z.B. „eSUN PLA+") statt nur des generischen Typs zeigen (Issue #57 Punkt 4).
        var materialLabel=empty?'–':((profile&&profile.name)?profile.name:genericType);
        var vendorBadge='';
        if(!empty && profile && profile.vendor){
          var tt=(profile.name||'')+(profile.id?' ('+profile.id+')':'');
          vendorBadge='<div class="slot-label" style="font-size:9px;color:var(--accent);font-weight:600;margin-top:1px" title="'+tt+'">'+profile.vendor+'</div>';
        }
        var spoolSel='';
        if(_spoolmanStatus.configured&&!empty&&_spoolmanSpools.length){
          var curSpool=_slotSpoolMap[String(globalIdx)]||'';
          var spoolOpts='<option value="">–</option>'+_spoolmanSpools.map(function(sp){
            var vendor=sp.filament&&sp.filament.vendor?sp.filament.vendor.name+' ':'';
            var name=sp.filament?sp.filament.name:'#'+sp.id;
            var rem=sp.remaining_weight!=null?' '+sp.remaining_weight.toFixed(0)+'g':'';
            return '<option value="'+sp.id+'"'+(String(sp.id)==String(curSpool)?' selected':'')+'>'+
                   escHtml(vendor+name+rem)+'</option>';
          }).join('');
          spoolSel='<div onclick="event.stopPropagation()" style="margin-top:6px;border-top:1px solid rgba(255,255,255,.07);padding-top:5px">'
            +'<div style="font-size:8px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">🧵 Spoolman</div>'
            +'<select data-spool-slot="'+globalIdx+'" onchange="onAmsSpoolChange(this)" '
            +'style="width:100%;padding:3px 5px;font-size:10px;border-radius:5px;border:1px solid var(--border);background:var(--card);color:var(--txt);cursor:pointer">'+spoolOpts+'</select>'
            +'</div>';
        }
        html+='<div class="ams-slot'+(active?' active':'')+(loaded?' loaded':'')+(activity?' '+activity:'')+(empty?' empty':'')
          +'" style="--slot-color:'+col+';opacity:'+(empty?0.4:1)+';cursor:pointer" onclick="openSlotEdit('+i+')">'
          +'<div class="slot-circle" style="background:'+col+'"></div>'
          +'<div class="slot-material" title="'+(empty?'':genericType)+'">'+materialLabel+'</div>'
          +vendorBadge
          +'<div class="slot-label">'+slotLabel+'</div>'
          +'<div class="slot-label" style="font-size:10px;color:var(--txt2)">'+pct+'</div>'
          +spoolSel
          +'<div style="font-size:9px;color:var(--txt2);margin-top:2px">✏</div>'
          +'</div>';
      });
      if(bid===-1&&acePresent){
        html+='<div class="ams-slot ams-slot-bridge" aria-label="'+T.label_slot+' 4">'
          +'<div class="bridge-chip">ACE</div>'
          +'</div>';
      }
      html+='</div></div>';
    });
  // Nicht rendern wenn ein Spool-Dropdown gerade offen ist (verhindert Schließen beim Poll)
  var activeEl=document.activeElement;
  var spoolOpen=activeEl&&activeEl.tagName==='SELECT'&&activeEl.dataset.spoolSlot!=null;
  if(!spoolOpen) document.getElementById('ams-slots').innerHTML=html;
  }

  // camera overlay
  var co=document.getElementById('cam-overlay');
  if(co)co.style.display=(s.print_state==='printing'&&camOn)?'block':'none';

  // auto-start camera during print (unless user explicitly stopped it)
  if(s.print_state==='printing'&&!camOn&&s.camera_url&&!camUserStopped&&s.camera_on_print){
    camStart();
  }
  // reset user-stopped flag when print ends so next print auto-starts again
  if(s.print_state!=='printing'){
    camUserStopped=false;
  }

  updateConnBtn();
}

function updateConnBtn(){
  var btn=document.getElementById('conn-btn');
  if(!btn)return;
  var offline=S.kobra_state==='offline';
  if(offline){
    btn.className='conn-btn disconnected';
    btn.textContent=tr('btn_connect');
  } else {
    btn.className='conn-btn connected';
    btn.textContent=tr('btn_disconnect');
  }
}

function toggleConnection(){
  var btn=document.getElementById('conn-btn');
  var offline=S.kobra_state==='offline';
  btn.disabled=true;
  btn.textContent='…';
  var url=offline?'/api/connect':'/api/disconnect';
  post(url,{}).then(function(r){return r.json()}).then(function(r){
    btn.disabled=false;
    if(r.error)addLog('Error: '+r.error);
  }).catch(function(){btn.disabled=false;});
}

// ── Temp history + chart ──
function updateHistory(){
  tempHistory.n.push(S.nozzle_temp);
  tempHistory.b.push(S.bed_temp);
  if(tempHistory.n.length>60)tempHistory.n.shift();
  if(tempHistory.b.length>60)tempHistory.b.shift();
  drawChart('d-chart',tempHistory,[{data:tempHistory.n,color:'#00c8ff',max:300},{data:tempHistory.b,color:'#ff6b35',max:120}]);
}
function drawChart(id,_,series){
  var canvas=document.getElementById(id);if(!canvas)return;
  var ctx=canvas.getContext('2d');
  var W=canvas.offsetWidth*window.devicePixelRatio||canvas.width;
  var H=canvas.offsetHeight*window.devicePixelRatio||canvas.height;
  canvas.width=W;canvas.height=H;
  ctx.clearRect(0,0,W,H);
  series.forEach(function(s){
    var data=s.data;if(!data.length)return;
    var max=s.max;
    ctx.beginPath();ctx.strokeStyle=s.color;ctx.lineWidth=2;ctx.lineJoin='round';
    data.forEach(function(v,i){
      var x=i/(Math.max(data.length-1,1))*(W-4)+2;
      var y=H-4-(v/max)*(H-8);
      if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
    });
    ctx.stroke();
  });
}

// ── Settings Modal ──
var _updateTag='';
var _updateUrl='';
function openSettings(){
  fetch(_apiUrl('/api/settings')).then(function(r){return r.json()}).then(function(d){
    document.getElementById('s-printer-name').value=d.printer_name||'';
    document.getElementById('s-printer-ip').value=d.printer_ip||'';
    document.getElementById('s-mqtt-port').value=d.mqtt_port||9883;
    document.getElementById('s-username').value=d.username||'';
    document.getElementById('s-password').value=d.password||'';
    document.getElementById('s-device-id').value=d.device_id||'';
    document.getElementById('s-mode-id').value=d.mode_id||'';
    var pon=document.getElementById('s-power-on-url');if(pon)pon.value=d.power_on_url||'';
    var poff=document.getElementById('s-power-off-url');if(poff)poff.value=d.power_off_url||'';
    var pstat=document.getElementById('s-power-status-url');if(pstat)pstat.value=d.power_status_url||'';
    var pinv=document.getElementById('s-power-status-inverted');if(pinv)pinv.checked=!!d.power_status_inverted;
    document.getElementById('s-default-slot').value=d.default_ams_slot||'auto';
    document.getElementById('s-auto-leveling').checked=(d.auto_leveling===undefined?true:!!d.auto_leveling);
    var vc=document.getElementById('s-vibration-compensation');if(vc)vc.checked=!!d.vibration_compensation;
    var cop=document.getElementById('s-camera-on-print');if(cop)cop.checked=!!d.camera_on_print;
    var frm=document.getElementById('s-file-ready-mode');if(frm)frm.value=(d.print_start_dialog===undefined?'1':String(d.print_start_dialog?1:0));
    var wuw=document.getElementById('s-web-upload-warning');if(wuw)wuw.checked=(d.web_upload_warning===undefined?true:!!d.web_upload_warning);
    var dpfap=document.getElementById('s-delete-printer-file-after-print');if(dpfap)dpfap.checked=!!d.delete_printer_file_after_print;
    // Poll-Intervall (Sekunden) — Backend hat Vorrang vor localStorage
    var pi=document.getElementById('s-poll-interval');
    if(pi){
      var sec=d.poll_interval||Math.round((parseInt(localStorage.getItem('pollInterval')||'2000'))/1000)||3;
      pi.value=sec;
    }
    var vhl=document.getElementById('s-verbose-http-log');if(vhl)vhl.checked=!!d.verbose_http_log;
    renderFilamentMapping(d.filament_profiles||{});
    renderSpoolmanSlotCard();
    // Spoolman
    var su=document.getElementById('s-spoolman-url');if(su)su.value=d.spoolman_server||'';
    var sr=document.getElementById('s-spoolman-sync-rate');if(sr)sr.value=(d.spoolman_sync_rate!==undefined?d.spoolman_sync_rate:30);
    _updateSpoolmanStatusDot();
  });
  // Sprach-Select im Settings-Panel mit aktueller Sprache spiegeln
  var ls=document.getElementById('s-lang-select');
  if(ls)ls.value=(localStorage.getItem('lang')||document.documentElement.lang||'de');
  document.getElementById('s-version-label').textContent='v'+('__VERSION__'||'?');
  document.getElementById('update-status').textContent='';
  document.getElementById('btn-update-apply').style.display='none';
  var cl=document.getElementById('update-changelog');if(cl)cl.style.display='none';
  _updateTag='';_updateUrl='';
  // Custom-Profile-Liste laden (Issue #41)
  refreshUserProfileList();
  // Vendor-Sichtbarkeitsfilter (Issue #41 Option A)
  loadVendorChecklist();
}
function closeSettings(){
  // Panel-Variante: zurück zum Dashboard
  showPanel('dashboard');
}

// Poll-Intervall-Feld → Live-Poll sofort übernehmen (Persistenz erst beim Speichern)
function onPollIntervalInput(){
  var pi=document.getElementById('s-poll-interval');
  if(!pi)return;
  var sec=parseInt(pi.value,10);
  if(sec>=1&&sec<=60)setPoll(sec*1000);
}

// ── Filament-Profil-Mapping pro Slot ([filament_profiles]) ──
// Pro Slot ein einzelnes Profil-Dropdown (vendor+name gemeinsam, gekeyt per
// _profileKey). Kein Freitext mehr → das (vendor,name)→id-Matching kann nicht
// mehr durch manuelle Eingabe brechen (Issue #57 Punkt 1). Optionen werden aus
// /kx/filament/profiles geladen, nach Vendor gruppiert, User-Profile zuerst,
// mit demselben Vendor-Sichtbarkeitsfilter wie das Slot-Edit-Dropdown.
function renderFilamentMapping(map){
  var el=document.getElementById('filament-mapping-list');
  if(!el)return;
  var rows='';
  for(var i=0;i<4;i++){
    var m=map[i]||map[String(i)]||{};
    var idHint=m.id?' <span style="color:var(--txt2);font-size:11px">('+m.id+')</span>':'';
    rows+='<div class="modal-field" style="margin-bottom:8px">'
      +'<label>Slot '+(i+1)+idHint+'</label>'
      +'<select id="fmap-'+i+'" data-vendor="'+(m.vendor||'')+'" data-name="'+(m.name||'')+'" style="width:100%"></select>'
      +'</div>';
  }
  el.innerHTML=rows;
  // Dropdowns befüllen (async, geteilter Profil-Cache + Vendor-Filter)
  for(var j=0;j<4;j++){ _fillMappingDropdown(j); }
}
function _fillMappingDropdown(slot){
  var sel=document.getElementById('fmap-'+slot);
  if(!sel) return;
  var wantKey=_profileKey(sel.dataset.vendor, sel.dataset.name);
  _loadOrcaFilaments(function(profiles){
    sel.innerHTML='<option value="">'+(tr('slot_edit_profile_default')||'Generic (Standard)')+'</option>';
    var userProfs=profiles.filter(function(p){return p.is_user;});
    var systemProfs=profiles.filter(function(p){return !p.is_user;});
    function _opt(g,p){
      var o=document.createElement('option');
      o.value=_profileKey(p.vendor,p.name);
      o.dataset.vendor=p.vendor; o.dataset.name=p.name; o.dataset.id=p.id||'';
      o.textContent=(p.is_user?'★ ':'')+p.name+(p.vendor?' — '+p.vendor:'');
      if(o.value===wantKey)o.selected=true;
      g.appendChild(o);
    }
    if(userProfs.length){
      var gUser=document.createElement('optgroup');
      gUser.label='★ '+(tr('orca_profile_user_label')||'Eigene Profile');
      userProfs.forEach(function(p){_opt(gUser,p);});
      sel.appendChild(gUser);
    }
    _loadVisibleVendors(function(vis){
      var filtered=systemProfs;
      if(vis&&vis.length){
        var allow={};vis.forEach(function(v){allow[v]=1;});allow['Generic']=1;
        filtered=systemProfs.filter(function(p){return allow[p.vendor];});
      }
      var byVendor={};
      filtered.forEach(function(p){(byVendor[p.vendor]=byVendor[p.vendor]||[]).push(p);});
      Object.keys(byVendor).sort().forEach(function(v){
        var g=document.createElement('optgroup');g.label=v;
        byVendor[v].forEach(function(p){_opt(g,p);});
        sel.appendChild(g);
      });
    });
  });
}
function saveFilamentMapping(){
  // Nutzt den per-Slot-Endpoint (vendor,name → ID-Lookup im Backend).
  // Leere Auswahl ("") = Mapping entfernen.
  var chain=Promise.resolve();
  for(var i=0;i<4;i++){
    (function(slot){
      var sel=document.getElementById('fmap-'+slot);
      var opt=sel?sel.options[sel.selectedIndex]:null;
      var vendor=(opt&&opt.dataset.vendor)||'';
      var name=(opt&&opt.dataset.name)||'';
      chain=chain.then(function(){
        return fetch(_apiUrl('/kx/filament/slots/'+slot+'/profile'),
          {method:'POST',headers:{'Content-Type':'application/json'},
           body:JSON.stringify({vendor:vendor,name:name})});
      });
    })(i);
  }
  chain.then(function(){
    clog(tr('log_filament_mapping_saved')||'Filament-Mapping gespeichert','msg-ok');
    openSettings(); // neu laden → ID-Hints aktualisieren
  }).catch(function(e){clog('Mapping-Fehler: '+e,'msg-err');});
}

// ── Vendor-Sichtbarkeitsfilter (Issue #41 Option A) ──
var _vendorChecklistSel={};  // {vendor:true} — laufende Auswahl im UI
function loadVendorChecklist(){
  // aktuelle Auswahl aus Backend, dann alle verfügbaren Vendoren rendern
  _visibleVendors=null; // Cache invalidieren
  _loadVisibleVendors(function(vis){
    _vendorChecklistSel={};
    (vis||[]).forEach(function(v){_vendorChecklistSel[v]=true;});
    renderVendorChecklist();
  });
}
function renderVendorChecklist(){
  var el=document.getElementById('visible-vendors-list');
  if(!el)return;
  _loadOrcaFilaments(function(profiles){
    // alle System-Vendoren (ohne Generic — der ist immer sichtbar) sammeln
    var set={};
    profiles.forEach(function(p){ if(!p.is_user && p.vendor && p.vendor!=='Generic') set[p.vendor]=1; });
    var vendors=Object.keys(set).sort();
    var q=((document.getElementById('vendor-filter-search')||{}).value||'').toLowerCase();
    if(q)vendors=vendors.filter(function(v){return v.toLowerCase().indexOf(q)>=0;});
    el.innerHTML=vendors.map(function(v){
      var ck=_vendorChecklistSel[v]?'checked':'';
      var safe=v.replace(/"/g,'&quot;');
      return '<label style="display:flex;align-items:center;gap:8px;padding:3px 0;cursor:pointer;font-size:13px">'
        +'<input type="checkbox" data-vendor="'+safe+'" '+ck+' onchange="_vendorCheck(this)" style="width:auto;margin:0"> '+v+'</label>';
    }).join('')||'<i style="color:var(--txt2)">–</i>';
  });
}
function _vendorCheck(cb){
  var v=cb.getAttribute('data-vendor');
  if(cb.checked)_vendorChecklistSel[v]=true; else delete _vendorChecklistSel[v];
}
function renderSpoolmanSlotCard(){
  var card=document.getElementById('spoolman-slot-card');
  var rows=document.getElementById('spoolman-slot-rows');
  if(!card||!rows)return;
  if(!_spoolmanStatus.configured){card.style.display='none';return;}
  card.style.display='';
  Promise.all([
    fetch(_apiUrl('/kx/spoolman/spools')).then(function(r){return r.json();}),
    fetch(_apiUrl('/kx/filament/slots')).then(function(r){return r.json();})
  ]).then(function(res){
    var spools=res[0].spools||[];
    var slots=(res[1].result||[]).sort(function(a,b){return a.slot_index-b.slot_index;});
    if(!slots.length){rows.innerHTML='<span style="font-size:11px;color:var(--txt2)">Keine AMS-Slots bekannt.</span>';return;}
    rows.innerHTML=slots.map(function(slot){
      var idx=parseInt(slot.slot_index);
      var col=slot.color_hex||'#888';
      var mat=slot.material||'';
      var current=_slotSpoolMap[String(idx)]||'';
      var opts='<option value="">–</option>'+spools.map(function(sp){
        var rem=sp.remaining_weight!=null?' ('+sp.remaining_weight.toFixed(0)+'g)':'';
        var vendor=sp.filament&&sp.filament.vendor?sp.filament.vendor.name+' ':'';
        var name=sp.filament?sp.filament.name:'Spool #'+sp.id;
        var mat2=sp.filament&&sp.filament.material?' · '+sp.filament.material:'';
        return '<option value="'+sp.id+'"'+(String(sp.id)==String(current)?' selected':'')+'>'+
               escHtml('#'+sp.id+' '+vendor+name+mat2+rem)+'</option>';
      }).join('');
      return '<div style="display:flex;align-items:center;gap:8px;font-size:12px">'+
        '<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:'+col+';border:1px solid var(--border);flex-shrink:0"></span>'+
        '<span style="color:var(--txt2);min-width:60px">Slot '+(idx+1)+' <span style="color:var(--txt2);font-size:10px">'+escHtml(mat)+'</span></span>'+
        '<select data-spool-slot="'+idx+'" style="flex:1;padding:3px 6px;border-radius:6px;border:1px solid var(--border);background:var(--raised);color:var(--txt);font-size:12px">'+opts+'</select></div>';
    }).join('');
  }).catch(function(){rows.innerHTML='<span style="font-size:11px;color:var(--err)">Spoolman nicht erreichbar</span>';});
}

function onAmsSpoolChange(sel){
  var idx=sel.getAttribute('data-spool-slot');
  var val=sel.value;
  if(val) _slotSpoolMap[String(idx)]=parseInt(val);
  else delete _slotSpoolMap[String(idx)];
  var mapping={};
  Object.keys(_slotSpoolMap).forEach(function(k){mapping[k]=_slotSpoolMap[k];});
  fetch(_apiUrl('/kx/spoolman/active-spool'),{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({slot_spools:mapping})});
}

function saveSpoolmanSlots(){
  var mapping={};
  document.querySelectorAll('#spoolman-slot-rows select[data-spool-slot]').forEach(function(sel){
    var idx=sel.getAttribute('data-spool-slot');
    var val=sel.value;
    if(val)mapping[idx]=parseInt(val);
  });
  fetch(_apiUrl('/kx/spoolman/active-spool'),{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({slot_spools:mapping})}).then(function(r){return r.json();}).then(function(d){
    _slotSpoolMap=d.slot_spools||{};
  });
}

function saveVisibleVendors(){
  var vendors=Object.keys(_vendorChecklistSel);
  fetch(_apiUrl('/kx/filament/visible_vendors'),{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({vendors:vendors})}).then(function(r){return r.json();}).then(function(){
    _visibleVendors=vendors.slice(); // Dropdown-Cache aktualisieren
    clog(tr('log_visible_vendors_saved')||'Hersteller-Auswahl gespeichert','msg-ok');
  }).catch(function(e){clog('Vendor-Filter-Fehler: '+e,'msg-err');});
}

// ── Custom Filament Profile Import (Issue #41) ──
function refreshUserProfileList(){
  var listEl=document.getElementById('orca-profiles-list');
  if(!listEl) return;
  fetch(_apiUrl('/kx/filament/profiles/user')).then(function(r){return r.json();}).then(function(d){
    var profs=(d && d.result)||[];
    if(!profs.length){
      listEl.innerHTML='<i style="color:var(--txt2)">'+(tr('orca_profile_user_empty')||'– keine –')+'</i>';
      return;
    }
    listEl.innerHTML=profs.map(function(p){
      var label=p.vendor+' / '+p.name+' ('+p.type+')';
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid var(--border)">'
        +'<span>★ '+label+'</span>'
        +'<button onclick="deleteUserProfile(\''+encodeURIComponent(p.vendor)+'\',\''+encodeURIComponent(p.name)+'\')" '
        +'style="background:none;border:none;color:var(--err);cursor:pointer;font-size:14px" title="löschen">🗑</button>'
        +'</div>';
    }).join('');
  }).catch(function(){});
}
function deleteUserProfile(vendor, name){
  fetch(_apiUrl('/kx/filament/profiles/user?vendor='+vendor+'&name='+name), {method:'DELETE'})
    .then(function(r){return r.json();})
    .then(function(){
      _orcaFilamentCache=null;
      refreshUserProfileList();
      // Falls Import-Dialog offen ist, dort auch refreshen
      refreshImportDialogList();
    });
}
function openProfileImport(){
  document.getElementById('profile-import-status').textContent='';
  refreshImportDialogList();
  document.getElementById('profile-import-modal').classList.add('open');
}
function closeProfileImport(){
  document.getElementById('profile-import-modal').classList.remove('open');
}
function refreshImportDialogList(){
  var el=document.getElementById('profile-import-list');
  if(!el) return;
  fetch(_apiUrl('/kx/filament/profiles/user')).then(function(r){return r.json();}).then(function(d){
    var profs=(d && d.result)||[];
    if(!profs.length){
      el.innerHTML='<i style="color:var(--txt2)">'+(tr('orca_profile_user_empty')||'– keine –')+'</i>';
      return;
    }
    el.innerHTML=profs.map(function(p){
      var label=p.vendor+' / '+p.name+' ('+p.type+')';
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 6px;border-bottom:1px solid var(--border)">'
        +'<span>★ '+label+'</span>'
        +'<button onclick="deleteUserProfile(\''+encodeURIComponent(p.vendor)+'\',\''+encodeURIComponent(p.name)+'\')" '
        +'style="background:none;border:none;color:var(--err);cursor:pointer;font-size:14px" title="löschen">🗑</button>'
        +'</div>';
    }).join('');
  }).catch(function(){});
}
function doProfileImportUpload(files){
  if(!files || !files.length) return;
  var status=document.getElementById('profile-import-status');
  status.textContent=(tr('orca_profile_uploading')||'Lade hoch…');
  status.style.color='var(--txt2)';
  var done=0, totalAdded=0, totalSkipped=0;
  function _one(idx){
    if(idx>=files.length){
      status.textContent=(tr('orca_profile_done')||'Importiert')+': '+totalAdded
        +(totalSkipped?' / '+totalSkipped+' '+(tr('orca_profile_skipped')||'übersprungen'):'');
      status.style.color='var(--ok)';
      _orcaFilamentCache=null;
      refreshImportDialogList();
      refreshUserProfileList();
      // Vendor-Checkliste neu aufbauen — ein Import kann einen bisher
      // unbekannten System-Vendor mitbringen (Issue #41).
      if(document.getElementById('visible-vendors-list')) renderVendorChecklist();
      // Wenn Slot-Edit offen ist, Dropdown gleich neu befüllen
      var mat=document.getElementById('slot-edit-mat');
      if(mat && document.getElementById('slot-edit-modal').classList.contains('open')){
        _fillSlotProfileDropdown(mat.value, '', '');
      }
      return;
    }
    var fd=new FormData();
    fd.append('file', files[idx]);
    fetch(_apiUrl('/kx/filament/profiles/user'), {method:'POST', body:fd})
      .then(function(r){return r.json();})
      .then(function(d){
        totalAdded += (d.added||0);
        totalSkipped += (d.skipped||0);
        done++;
        _one(idx+1);
      })
      .catch(function(e){
        status.textContent='Fehler: '+e;
        status.style.color='var(--err)';
      });
  }
  _one(0);
}

// ── AMS Slot Edit ──
var _slotEditIndex=-1;
var _slotEditLoaded=false;
var _MAT_PRESETS=['PLA','PLA+','PLA SILK','PLA MATTE','PETG','ABS','ASA','TPU','PA','PC','HIPS'];
function _normalizeMat(m){
  var s=m.toUpperCase().trim().replace(/-/g,' ').replace(/_/g,' ');
  var aliases={'PLAPLUS':'PLA+','PLA PLUS':'PLA+','SILK PLA':'PLA SILK','PLASILK':'PLA SILK',
    'PLA MATTE':'PLA','PLA MARBLE':'PLA','PLA WOOD':'PLA','TPE':'TPU',
    'PETG PLUS':'PETG+','PA6':'PA','PA12':'PA','PA66':'PA'};
  return aliases[s]||s;
}
var _BASE_MATERIAL_TYPES=['PLA','PETG','ABS','ASA','TPU','TPE','PA','PC','HIPS','PEI','PEEK'];
function updateSlotEditFeedButton(){
  var btn=document.getElementById('btn-slot-edit-feed');
  if(!btn)return;
  if(_slotEditIndex<0){
    btn.style.display='none';
    return;
  }
  btn.style.display='';
  btn.textContent=_slotEditLoaded?tr('slot_edit_unload'):tr('slot_edit_load');
}
var _orcaFilamentCache=null;  // [{id,name,vendor,type,color}, …]
var _visibleVendors=null;     // Vendor-Sichtbarkeitsfilter (Issue #41); [] = alle
function _loadVisibleVendors(cb){
  if(_visibleVendors!==null){ cb(_visibleVendors); return; }
  fetch(_apiUrl('/kx/filament/visible_vendors')).then(function(r){return r.json();}).then(function(d){
    _visibleVendors=d.result||[];
    cb(_visibleVendors);
  }).catch(function(){ _visibleVendors=[]; cb([]); });
}
function _loadOrcaFilaments(cb){
  if(_orcaFilamentCache){ cb(_orcaFilamentCache); return; }
  fetch(_apiUrl('/kx/filament/profiles')).then(function(r){return r.json();}).then(function(d){
    _orcaFilamentCache=d.result||[];
    cb(_orcaFilamentCache);
  }).catch(function(){ cb([]); });
}
function _profileKey(vendor, name){
  // Eindeutiger Selector: (vendor, name). IDs aus orca_filaments.json sind
  // NICHT eindeutig (z.B. 136 Profile mit OGFL99). Wir kodieren beide in den
  // <option>-Value-String mit | als Trenner.
  return (vendor||'')+'|'+(name||'');
}
function _fillSlotProfileDropdown(material, currentVendor, currentName){
  var sel=document.getElementById('slot-edit-profile');
  if(!sel) return;
  var wantKey=_profileKey(currentVendor, currentName);
  _loadOrcaFilaments(function(profiles){
    // Type-Filter: nur Profile vom passenden material zeigen (z.B. PLA → alle PLA-Varianten)
    var matU=(material||'').toUpperCase().trim();
    // PLA-Varianten: Drucker meldet "PLA SILK"/"PLA+"/"PLA MATTE", OrcaSlicer
    // speichert alle unter type=PLA — Namens-Keyword als Zusatzfilter.
    var _PLA_VARIANT_KW={'PLA SILK':'silk','PLA+':'pla+','PLA MATTE':'matte',
      'PLA MARBLE':'marble','PLA WOOD':'wood'};
    var variantKw=_PLA_VARIANT_KW[matU]||null;
    var baseMat=variantKw?'PLA':matU;
    var matched=profiles.filter(function(p){
      var pt=(p.type||'').toUpperCase();
      var nameL=(p.name||'').toLowerCase();
      // Basis-Typ muss passen
      var typeOk=baseMat===''||pt===baseMat||pt.startsWith(baseMat+'-')||pt.startsWith(baseMat+' ');
      if(!typeOk) return false;
      // Bei Variante: Name muss Keyword enthalten (z.B. "silk", "matte", "pla+")
      if(variantKw) return nameL.indexOf(variantKw)!==-1;
      return true;
    });
    sel.innerHTML='<option value="">'+tr('slot_edit_profile_default')+'</option>';
    // User-Profile (is_user) zuerst — eigene Optgroup '★ Eigene' an erster Stelle.
    var userProfs=matched.filter(function(p){return p.is_user;});
    var systemProfs=matched.filter(function(p){return !p.is_user;});
    function _appendOption(g, p){
      var o=document.createElement('option');
      o.value=_profileKey(p.vendor, p.name);
      o.dataset.vendor=p.vendor;
      o.dataset.name=p.name;
      o.dataset.id=p.id || '';
      o.textContent=(p.is_user?'★ ':'')+p.name;
      if(o.value===wantKey) o.selected=true;
      g.appendChild(o);
    }
    if(userProfs.length){
      var gUser=document.createElement('optgroup');
      gUser.label='★ '+(tr('orca_profile_user_label')||'Eigene Profile');
      userProfs.forEach(function(p){ _appendOption(gUser, p); });
      sel.appendChild(gUser);
    }
    // Vendor-Sichtbarkeitsfilter (Issue #41 Option A): nur gewählte Vendoren +
    // Generic. Leere Liste = alle (rückwärtskompatibel). Eigene Profile (is_user)
    // sind oben bereits unkonditional drin.
    _loadVisibleVendors(function(vis){
      var filtered=systemProfs;
      if(vis&&vis.length){
        var allow={};vis.forEach(function(v){allow[v]=1;});
        allow['Generic']=1;
        filtered=systemProfs.filter(function(p){return allow[p.vendor];});
      }
      var byVendor={};
      filtered.forEach(function(p){ (byVendor[p.vendor]=byVendor[p.vendor]||[]).push(p); });
      Object.keys(byVendor).sort().forEach(function(v){
        var g=document.createElement('optgroup'); g.label=v;
        byVendor[v].forEach(function(p){ _appendOption(g, p); });
        sel.appendChild(g);
      });
    });
  });
}
// ── Pickr color picker ──────────────────────────────────────────────────────
var _pickr=null;

function _initPickr(hex){
  // destroy previous instance if exists
  if(_pickr){ try{ _pickr.destroyAndRemove(); }catch(e){} _pickr=null; }
  var anchor=document.getElementById('slot-pickr-anchor');
  if(!anchor||typeof Pickr==='undefined') return;
  // fresh button element so Pickr can mount
  anchor.innerHTML='<div id="slot-pickr-btn"></div>';
  _pickr=Pickr.create({
    el:'#slot-pickr-btn',
    theme:'nano',
    default: hex||'#808080',
    inline: true,
    showAlways: true,
    components:{
      preview:true, opacity:false, hue:true,
      interaction:{ hex:true, rgba:false, input:true, save:false, clear:false }
    }
  });
  _pickr.on('change',function(color){
    var h=color.toHEXA().toString().slice(0,7);
    document.getElementById('slot-edit-color').value=h;
    document.getElementById('slot-edit-preview').style.background=h;
  });
  // Theme anpassen: Pickr benutzt eigene CSS-Variablen, wir überschreiben via style
  requestAnimationFrame(function(){
    var el=anchor.querySelector('.pickr');
    if(el) el.style.cssText='width:100%';
    var app=anchor.querySelector('.pcr-app');
    if(app){
      app.style.cssText='position:relative;width:100%;box-shadow:none;background:transparent';
      var btn=app.querySelector('.pcr-result');
      if(btn) btn.style.cssText='background:var(--raised);border:1px solid var(--border);color:var(--txt);border-radius:6px;font-size:12px';
    }
  });
}

// ── Color swatches (localStorage, max 16) ──────────────────────────────────
var _SWATCH_KEY='kxb_color_swatches';
var _SWATCH_MAX=16;

function _loadSwatches(){
  try{ return JSON.parse(localStorage.getItem(_SWATCH_KEY)||'[]'); }catch(e){ return []; }
}
function _saveSwatches(arr){ try{ localStorage.setItem(_SWATCH_KEY, JSON.stringify(arr)); }catch(e){} }

function _addSwatch(hex){
  var arr=_loadSwatches().filter(function(c){ return c.toLowerCase()!==hex.toLowerCase(); });
  arr.unshift(hex);
  if(arr.length>_SWATCH_MAX) arr=arr.slice(0,_SWATCH_MAX);
  _saveSwatches(arr);
}

function _renderSwatches(){
  var el=document.getElementById('slot-color-swatches');
  if(!el) return;
  var arr=_loadSwatches();
  if(!arr.length){ el.style.display='none'; return; }
  el.style.display='flex';
  el.innerHTML=arr.map(function(c){
    return '<div title="'+c+'" onclick="slotPickSwatch(\''+c+'\')" style="width:22px;height:22px;border-radius:4px;background:'+c+
      ';border:2px solid rgba(255,255,255,.2);cursor:pointer;flex-shrink:0"></div>';
  }).join('');
}

function slotPickSwatch(hex){
  if(_pickr){ _pickr.setColor(hex); }
  var ci=document.getElementById('slot-edit-color');
  if(ci) ci.value=hex;
  document.getElementById('slot-edit-preview').style.background=hex;
}

// ── Copy color from other slot ──────────────────────────────────────────────
function _renderCopyFromSlot(currentGlobalIdx){
  var slots=(window._amsSlots||[]).filter(function(s){
    return s.global_index!==currentGlobalIdx && s.status==5 && Array.isArray(s.color);
  });
  var row=document.getElementById('slot-copy-row');
  var sel=document.getElementById('slot-copy-select');
  if(!row||!sel) return;
  if(!slots.length){ row.style.display='none'; return; }
  row.style.display='';
  var ph=document.getElementById('lbl-slot-copy-from');
  var phTxt=ph?ph.textContent:(T.slot_copy_from||'Copy color from slot…');
  sel.innerHTML='<option value="">'+phTxt+'</option>'+slots.map(function(s){
    var rgb=s.color;
    var hex='#'+rgb.map(function(v){return('0'+Math.min(255,v).toString(16)).slice(-2)}).join('');
    return '<option value="'+hex+'">Slot '+(s.global_index+1)+' — '+(s.type||'?')+' '+hex+'</option>';
  }).join('');
}

function slotCopyColor(sel){
  if(!sel.value) return;
  var ci=document.getElementById('slot-edit-color');
  if(!ci) return;
  ci.value=sel.value;
  document.getElementById('slot-edit-preview').style.background=sel.value;
  sel.selectedIndex=0;
}

// ───────────────────────────────────────────────────────────────────────────

function openSlotEdit(i){
  var slot=(window._amsSlots||[])[i]||{};
  var globalIdx=slot.global_index!=null?slot.global_index:(slot.index!=null?slot.index:i);
  _slotEditIndex=globalIdx;
  _slotEditLoaded=(S.ams_loaded_slot!=null&&S.ams_loaded_slot===globalIdx);
  document.getElementById('slot-edit-title').textContent=T.slot_edit_title+' '+(globalIdx+1);
  var rgb=Array.isArray(slot.color)?slot.color:[128,128,128];
  var hex='#'+rgb.map(function(v){return('0'+Math.min(255,v).toString(16)).slice(-2)}).join('');
  var ci=document.getElementById('slot-edit-color');
  ci.value=hex;
  document.getElementById('slot-edit-preview').style.background=hex;
  _initPickr(hex);
  _renderSwatches();
  _renderCopyFromSlot(globalIdx);
  var mat=(slot.type||'PLA').toUpperCase();
  document.getElementById('slot-edit-mat').value=mat;
  // Normalisieren für Button-Highlighting: PLA-Varianten auf nächsten Preset mappen
  var matNorm=_normalizeMat(mat);
  var btns=document.getElementById('slot-mat-btns');
  btns.innerHTML=_MAT_PRESETS.map(function(m){
    var active=m===mat||m===matNorm;
    return '<button class="mat-preset-btn" data-mat="'+m+'" onclick="selectMatPreset(\''+m+'\')" '
      +'style="padding:4px 10px;border-radius:6px;border:1px solid var(--border);cursor:pointer;font-size:12px;'
      +(active?'background:var(--accent);color:#fff':'background:var(--raised);color:var(--txt2)')+'">'+m+'</button>';
  }).join('');
  // OrcaSlicer-Profil-Dropdown: aktuellen User-Override für diesen Slot
  // aus /kx/filament/slots holen (enthält vendor+name+id).
  fetch(_apiUrl('/kx/filament/slots')).then(function(r){return r.json();}).then(function(d){
    var arr=d.result||[];
    var entry=arr.find(function(x){return x.slot_index===globalIdx;})||{};
    window._slotProfileMap=window._slotProfileMap||{};
    window._slotProfileMap[globalIdx]={
      id:    entry.filament_id||'',
      vendor:entry.filament_vendor||'',
      name:  entry.filament_name||'',
    };
    _fillSlotProfileDropdown(mat, entry.filament_vendor||'', entry.filament_name||'');
  }).catch(function(){ _fillSlotProfileDropdown(mat,'',''); });
  updateSlotEditFeedButton();
  document.getElementById('slot-edit-modal').classList.add('open');
}
function closeSlotEdit(){
  _slotEditIndex=-1;
  document.getElementById('slot-edit-modal').classList.remove('open');
}
function slotEditFeed(){
  if(_slotEditIndex<0)return;
  var type=_slotEditLoaded?2:1;
  amsFeed(type,_slotEditIndex)
    .then(function(){
      _slotEditLoaded=!_slotEditLoaded;
      updateSlotEditFeedButton();
      poll();
    })
    .catch(function(){});
}
function startReadyFile(filename){
  var fn=filename||S.file_ready;
  function _doStartReadyFile(){
    var btn=document.getElementById('file-ready-btn');
    if(btn){btn.disabled=true;btn.textContent='…';}
    post('/printer/print/start',{filename:fn})
      .then(function(r){return r.json();})
      .then(function(){
        document.getElementById('file-ready-banner').style.display='none';
        if(btn){btn.disabled=false;setText('file-ready-btn',T.file_ready_btn);}
      })
      .catch(function(e){
        clog(tr('log_error')+' '+e,'msg-err');
        if(btn){btn.disabled=false;setText('file-ready-btn',T.file_ready_btn);}
      });
  }
  function _gateAndStart(fileObj){
    if(fileObj && fileObj.web_unverified && webUploadWarningEnabled()){
      maybeGateWebUpload(fileObj, function(){ startReadyFile(fn); });
      return;
    }
    _doStartReadyFile();
  }
  var currentFile=(storeFiles||[]).find(function(f){return f.filename===fn;});
  if(currentFile){
    _gateAndStart(currentFile);
    return;
  }
  fetch(_apiUrl('/kx/files')).then(function(r){return r.json();}).then(function(d){
    storeFiles=d.result||[];
    var refreshed=(storeFiles||[]).find(function(f){return f.filename===fn;})||null;
    _gateAndStart(refreshed);
  }).catch(function(){
    _doStartReadyFile();
  });
}
function cancelReadyFile(){
  post('/api/file_ready/clear',{})
    .then(function(){document.getElementById('file-ready-banner').style.display='none';});
}

// ── Aktionen für geladene/idle Datei in der Progress-Karte (Issue #55) ──
function startIdleFile(){
  if(_lastLoadedFile) startReadyFile(_lastLoadedFile);
}
function startIdleFileWithSlots(){
  if(_lastLoadedFile) startReadyFileWithSlots(_lastLoadedFile);
}
function clearIdleFile(){
  _lastLoadedFile=null;
  _idleCleared=true;  // verhindert Nachladen von s.filename im nächsten poll() (Issue #57)
  _fdAutoOpenedFile=null;  // nächster Upload derselben Datei soll Dialog wieder öffnen
  _fdUserCancelled=false;
  _fdDialogOpen=false;
  sessionStorage.removeItem('fdAutoOpenedFile');
  sessionStorage.removeItem('fdUserCancelled');
  sessionStorage.removeItem('webVerifyCancelledFileId');
  S.file_ready=''; S.filename=''; S.thumbnail='';  // sofort lokal leeren, kein Warten auf nächsten Poll
  var ib=document.getElementById('d-idle-btns');if(ib)ib.style.display='none';
  var fn=document.getElementById('d-fname');if(fn){fn.textContent='–';fn.title='';}
  var thumb=document.getElementById('d-thumbnail');if(thumb){thumb.style.display='none';thumb.src='';}
  post('/api/file_ready/clear',{}).catch(function(){});
}
function selectMatPreset(m){
  document.getElementById('slot-edit-mat').value=m;
  highlightMatBtn(m);
  // Filament-Profile-Dropdown an neues Material anpassen
  // (vorherige Selektion zurücksetzen — andere Material-Profile passen nicht)
  _fillSlotProfileDropdown(m, '', '');
}
function highlightMatBtn(val){
  document.querySelectorAll('.mat-preset-btn').forEach(function(b){
    var on=b.getAttribute('data-mat')===val.toUpperCase();
    b.style.background=on?'var(--accent)':'var(--raised)';
    b.style.color=on?'#fff':'var(--txt2)';
  });
  // Auch bei manueller Eingabe ins Material-Textfeld: Dropdown refreshen.
  if(val) _fillSlotProfileDropdown(val, '', '');
}
function hexToRgb(hex){
  var r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  return[r,g,b];
}
function saveSlotEdit(){
  var hex=document.getElementById('slot-edit-color').value;
  _addSwatch(hex);
  var mat=document.getElementById('slot-edit-mat').value.trim().toUpperCase()||'PLA';
  var color=hexToRgb(hex);
  var slotIdx=_slotEditIndex;
  var profSel=document.getElementById('slot-edit-profile');
  var sel=profSel && profSel.selectedOptions && profSel.selectedOptions[0];
  // Primärer Selector: (vendor, name). id ist nur Hint (aus dem JSON-data-attr
  // mitgegeben — Backend lookt sie nochmal selber nach um veraltete Hints zu
  // korrigieren).
  var newProfVendor=sel?(sel.dataset.vendor||''):'';
  var newProfName  =sel?(sel.dataset.name  ||''):'';
  var newProfId    =sel?(sel.dataset.id    ||''):'';
  // Sequenziell speichern: erst Profil-Override (config.ini), dann Material/Farbe
  // (MQTT zum Drucker). Sonst können beide Pfade sich überholen und der Slot-State
  // ist beim nächsten Re-Open inkonsistent.
  fetch(_apiUrl('/kx/filament/slots/'+slotIdx+'/profile'),{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({vendor:newProfVendor, name:newProfName, id:newProfId})
  })
  .then(function(r){return r.json();})
  .then(function(){
    window._slotProfileMap=window._slotProfileMap||{};
    if(newProfVendor && newProfName){
      window._slotProfileMap[slotIdx]={id:newProfId, vendor:newProfVendor, name:newProfName};
    } else {
      delete window._slotProfileMap[slotIdx];
    }
    return post('/api/ams/set_slot',{index:slotIdx,type:mat,color:color});
  })
  .then(function(r){return r?r.json():null;})
  .then(function(){
    // Slot-Map refreshen damit die Karte sofort den Vendor zeigt.
    return fetch(_apiUrl('/kx/filament/slots')).then(function(r){return r.json();});
  })
  .then(function(d){
    var arr=(d && d.result)||[];
    window._slotProfileMap={};
    arr.forEach(function(e){
      if(e.filament_vendor && e.filament_name){
        window._slotProfileMap[e.slot_index]={
          id:    e.filament_id||'',
          vendor:e.filament_vendor,
          name:  e.filament_name,
        };
      }
    });
    closeSlotEdit();
    var profSuffix=newProfName?(' ['+newProfVendor+' '+newProfName+']'):'';
    clog(tr('slot_edit_ok')+' '+(slotIdx+1)+': '+mat+' '+hex+profSuffix,'msg-ok');
    // Sofortiges Re-Render mit aktuellem _slotProfileMap (poll() ist async
    // und re-rendert beim nächsten Tick — wir wollen aber dass die Vendor-
    // Badge JETZT direkt sichtbar wird).
    if(typeof applyState==='function') applyState();
    if(typeof poll==='function') poll();
  })
  .catch(function(e){clog('Fehler: '+e,'msg-err');});
}
document.addEventListener('DOMContentLoaded',function(){
  document.getElementById('s-printer-ip').addEventListener('input',function(){
    var hint=document.getElementById('lbl-ip-hint');
    if(this.value.includes(':')){hint.textContent=T.hint_ip_no_port;hint.style.display='block';}
    else{hint.style.display='none';}
  });
});
function setPoll(ms){
  localStorage.setItem('pollInterval',ms);
  clearInterval(pollTimer);
  pollTimer=setInterval(poll,ms);
}
function saveSettings(){
  var btn=document.getElementById('btn-save-settings');
  btn.disabled=true;btn.textContent='…';
  var webUploadWarning=(document.getElementById('s-web-upload-warning')||{}).checked?1:0;
  S.web_upload_warning=webUploadWarning;
  // Start-Print-Behavior-Wechsel könnte den Auto-Open sonst dauerhaft blockieren
  // (alter _fdUserCancelled bei gleicher file_ready) → Dialog-State zurücksetzen (Issue #57).
  _fdUserCancelled=false;_fdAutoOpenedFile=null;
  sessionStorage.removeItem('fdUserCancelled');sessionStorage.removeItem('fdAutoOpenedFile');
  sessionStorage.removeItem('webVerifyCancelledFileId');
  post('/api/settings',{
    printer_name:     document.getElementById('s-printer-name').value,
    printer_ip:       document.getElementById('s-printer-ip').value,
    mqtt_port:        parseInt(document.getElementById('s-mqtt-port').value)||9883,
    username:         document.getElementById('s-username').value,
    password:         document.getElementById('s-password').value,
    device_id:        document.getElementById('s-device-id').value,
    mode_id:          document.getElementById('s-mode-id').value,
    power_on_url:     (document.getElementById('s-power-on-url')||{}).value||'',
    power_off_url:    (document.getElementById('s-power-off-url')||{}).value||'',
    power_status_url: (document.getElementById('s-power-status-url')||{}).value||'',
    power_status_inverted: (document.getElementById('s-power-status-inverted')||{}).checked?1:0,
    default_ams_slot: document.getElementById('s-default-slot').value,
    auto_leveling:           document.getElementById('s-auto-leveling').checked?1:0,
    vibration_compensation:  (document.getElementById('s-vibration-compensation')||{}).checked?1:0,
    camera_on_print:         (document.getElementById('s-camera-on-print')||{}).checked?1:0,
    print_start_dialog: parseInt((document.getElementById('s-file-ready-mode')||{}).value||'1',10),
    web_upload_warning:webUploadWarning,
    delete_printer_file_after_print: (document.getElementById('s-delete-printer-file-after-print')||{}).checked?1:0,
    poll_interval:    Math.min(60,Math.max(1,parseInt((document.getElementById('s-poll-interval')||{}).value,10)||3)),
    verbose_http_log: (document.getElementById('s-verbose-http-log')||{}).checked?1:0,
    spoolman_server:  (document.getElementById('s-spoolman-url')||{}).value||'',
    spoolman_sync_rate: Math.max(0,parseInt((document.getElementById('s-spoolman-sync-rate')||{}).value||'30',10)),
  }).then(function(){
    btn.textContent=T.update_restarting;
    setTimeout(function(){
      btn.disabled=false;
      setText('btn-save-settings',T.settings_save);
      closeSettings();
      _loadSpoolmanStatus();
      poll();
    },4000);
  }).catch(function(e){
    btn.disabled=false;setText('btn-save-settings',T.settings_save);
    clog('Settings-Fehler: '+e,'msg-err');
  });
}
var _updateDockerOnly=false;
function checkUpdate(){
  var sb=document.getElementById('update-status');
  sb.textContent=T.update_checking;
  document.getElementById('btn-update-apply').style.display='none';
  _updateTag='';_updateUrl='';_updateDockerOnly=false;
  fetch(_apiUrl('/api/update/check')).then(function(r){return r.json()}).then(function(d){
    if(d.error){sb.textContent=T.update_error+': '+d.error;return;}
    var cl=document.getElementById('update-changelog');
    if(d.changelog&&d.changelog.trim()){
      // Changelog als Markdown-Text (pre-formatiert) anzeigen
      cl.textContent=d.changelog;cl.style.display='block';
    } else {cl.style.display='none';}
    _updateDockerOnly=!!d.docker_only;
    if(d.update_available){
      sb.textContent=d.latest+' '+T.update_available;
      sb.style.color='var(--ok)';
      _updateTag=d.tag;_updateUrl=d.download_url||'';
      var btn=document.getElementById('btn-update-apply');
      if(_updateDockerOnly){
        btn.textContent=T.update_docker||'docker compose pull';
        btn.title='docker compose pull && docker compose up -d';
      } else {
        btn.textContent=T.update_apply;
        btn.title='';
      }
      btn.style.display='inline-block';
    } else {
      sb.textContent=T.update_none;
      sb.style.color='var(--txt2)';
    }
  }).catch(function(e){sb.textContent=T.update_error+': '+e;});
}
function applyUpdate(){
  var sb=document.getElementById('update-status');
  var btn=document.getElementById('btn-update-apply');
  if(_updateDockerOnly){
    // Nightly: kein Self-Update, Docker-Befehl in Zwischenablage kopieren
    var cmd='docker compose pull && docker compose up -d';
    if(navigator.clipboard){
      navigator.clipboard.writeText(cmd).then(function(){
        sb.textContent=T.update_docker_copied||'Befehl kopiert: '+cmd;
      });
    } else {
      sb.textContent=cmd;
    }
    return;
  }
  if(!_updateUrl)return;
  btn.disabled=true;sb.textContent=T.update_applying;
  post('/api/update/apply',{download_url:_updateUrl,tag:_updateTag}).then(function(){
    sb.textContent=T.update_restarting;
    closeSettings();
    setTimeout(function(){poll();},5000);
  }).catch(function(e){
    btn.disabled=false;sb.textContent=T.update_error+': '+e;
  });
}

// ── Poll ──
async function poll(){
  try{
    var r=await fetch(_apiUrl('/api/state'));
    if(!r.ok)return;
    var d=await r.json();
    Object.assign(S,d);
    applyState();
    updateHistory();
  }catch(e){clog(T.log_poll_error+' '+e,'msg-err')}
}
var pollTimer;
(function(){
  var ms=parseInt(localStorage.getItem('pollInterval')||'2000');
  initPrinters();
  // Slot-Profile-Map initial laden, sonst zeigen die Karten beim ersten
  // Render keine Vendor-Badge obwohl in der config.ini ein Override steht.
  fetch(_apiUrl('/kx/filament/slots')).then(function(r){return r.json();}).then(function(d){
    var arr=(d && d.result)||[];
    window._slotProfileMap={};
    arr.forEach(function(e){
      if(e.filament_vendor && e.filament_name){
        window._slotProfileMap[e.slot_index]={
          id:    e.filament_id||'',
          vendor:e.filament_vendor,
          name:  e.filament_name,
        };
      }
    });
  }).catch(function(){});
  poll();pollTimer=setInterval(poll,ms);
  setInterval(_loadSpoolmanStatus,30000);
  setInterval(_refreshHeaderPower,30000);
  // initDashGrid() is called at the very end of the file, after all the
  // DASH_* var declarations below have executed (they are hoisted but not yet
  // assigned at this point in the IIFE).
})();

// ── Dashboard Free Grid (Issue #89) ────────────────────────────────────────
// User-customizable dashboard powered by GridStack (v10, docs: gridstack.js).
// Cards move + resize on a 12-column snap grid; layout persisted per browser
// in localStorage. Built on documented APIs only:
//   - float:false (default)  -> compact packing, no holes between cards
//   - staticGrid:true        -> locked by default, setStatic(false) in edit mode
//   - grid.save(false)/load(layout,false) -> serialize/restore by gs-id
//   - draggable.cancel       -> inputs/buttons/img excluded from drag start
//   - columnOpts.breakpoints -> 1-column below 700px GRID width (sidebar-aware)
var DASH_STORAGE_KEY='dashLayout';
var DASH_LAYOUT_VERSION=3;   // v1/v2 = older editors; discard those states
var DASH_CARD_KEYS=['camera','progress','temps','motion','speed','fan','ams'];
// Layout arrays in GridStack save()/load() format. cellHeight=60px.
var DASH_DEFAULT_LAYOUT=[
  {id:'camera',  x:0,y:0, w:12,h:7},
  {id:'progress',x:0,y:7, w:12,h:6},
  {id:'temps',   x:0,y:13,w:6, h:7},
  {id:'motion',  x:6,y:13,w:6, h:7},
  {id:'speed',   x:0,y:20,w:6, h:3},
  {id:'fan',     x:6,y:20,w:6, h:3},
  {id:'ams',     x:0,y:23,w:12,h:4},
];
// "Wide desktop" preset (Blaim, Issue #89): big camera left, settings center,
// motion right.
var DASH_PRESET_WIDE=[
  {id:'progress',x:0, y:0, w:12,h:4},
  {id:'camera',  x:0, y:4, w:6, h:11},
  {id:'temps',   x:6, y:4, w:3, h:7},
  {id:'speed',   x:6, y:11,w:3, h:2},
  {id:'fan',     x:6, y:13,w:3, h:2},
  {id:'motion',  x:9, y:4, w:3, h:11},
  {id:'ams',     x:0, y:15,w:12,h:4},
];
var _dashGrid=null;
var _dashEditing=false;
var _dashHidden=[];   // [{id,x,y,w,h}] cards currently hidden (position kept for re-show)

// GridStack requires .grid-stack-item > .grid-stack-item-content around each
// card — wrap the existing .card elements in place (IDs/event handlers survive,
// appendChild moves nodes without recreating them).
function _dashWrapCards(){
  var grid=document.getElementById('dash-grid');
  if(!grid)return;
  DASH_CARD_KEYS.forEach(function(key){
    var card=grid.querySelector('[data-card="'+key+'"]');
    if(!card||card.parentNode.classList.contains('grid-stack-item-content'))return;
    var item=document.createElement('div');
    item.className='grid-stack-item';
    item.setAttribute('gs-id',key);
    var content=document.createElement('div');
    content.className='grid-stack-item-content';
    grid.insertBefore(item,card);
    item.appendChild(content);
    content.appendChild(card);
  });
}

function _dashItem(key){
  return document.querySelector('#dash-grid .grid-stack-item[gs-id="'+key+'"]');
}

function _dashLoadState(){
  try{
    var raw=localStorage.getItem(DASH_STORAGE_KEY);
    if(!raw)return null;
    var s=JSON.parse(raw);
    if(!s||s.version!==DASH_LAYOUT_VERSION||!Array.isArray(s.layout))return null;
    return s;
  }catch(e){return null;}
}
function _dashSaveState(){
  if(!_dashGrid)return;
  localStorage.setItem(DASH_STORAGE_KEY,JSON.stringify({
    version:DASH_LAYOUT_VERSION,
    layout:_dashGrid.save(false),   // [{id,x,y,w,h},…] — visible widgets only
    hidden:_dashHidden.slice(),
  }));
}

function initDashGrid(){
  var el=document.getElementById('dash-grid');
  if(!el||typeof GridStack==='undefined')return;
  _dashWrapCards();
  _dashGrid=GridStack.init({
    cellHeight:60,
    margin:8,
    staticGrid:true,   // locked by default; setStatic(false) enables drag+resize
    columnOpts:{breakpoints:[{w:700,c:1}]},  // grid-width based (sidebar-aware)
    draggable:{cancel:'input,textarea,button,select,option,img,.slider'},
  },el);
  var state=_dashLoadState();
  if(state){
    _dashHidden=Array.isArray(state.hidden)?state.hidden:[];
    _dashGrid.load(state.layout,false);       // update matching ids, no add/remove
    _dashHidden.forEach(function(n){
      var item=_dashItem(n.id);
      if(item){_dashGrid.removeWidget(item,false);item.style.display='none';}
    });
  }else{
    _dashGrid.load(DASH_DEFAULT_LAYOUT,false);
  }
  _dashGrid.on('change',function(){if(_dashEditing)_dashSaveState();});
  _dashRefreshPresetDropdown();
}

function toggleDashEdit(){
  if(!_dashGrid)return;
  _dashEditing=!_dashEditing;
  _dashGrid.setStatic(!_dashEditing);
  document.getElementById('dash-grid').classList.toggle('editing',_dashEditing);
  document.getElementById('dash-lbl-edit').textContent=_dashEditing?(T.dash_done||'Done'):(T.dash_edit||'Customize dashboard');
  document.getElementById('dash-reset-btn').style.display=_dashEditing?'':'none';
  document.getElementById('dash-preset').style.display=_dashEditing?'':'none';
  document.getElementById('dash-preset-save-btn').style.display=_dashEditing?'':'none';
  _dashUpdatePresetDeleteBtn();
  if(_dashEditing)_dashInjectControls(); else _dashRemoveControls();
  _dashRenderHiddenBar();
  if(!_dashEditing)_dashSaveState();
}

// ── Custom presets (user-saved layouts) ────────────────────────────────────
var DASH_CUSTOM_PRESETS_KEY='dashCustomPresets';
var DASH_BUILTIN_PRESET_IDS=['standard','wide89'];

function _dashLoadCustomPresets(){
  try{
    var raw=localStorage.getItem(DASH_CUSTOM_PRESETS_KEY);
    var obj=raw?JSON.parse(raw):{};
    return (obj&&typeof obj==='object')?obj:{};
  }catch(e){return {};}
}
function _dashSaveCustomPresets(presets){
  localStorage.setItem(DASH_CUSTOM_PRESETS_KEY,JSON.stringify(presets));
}

function _dashRefreshPresetDropdown(){
  var sel=document.getElementById('dash-preset');
  if(!sel)return;
  var current=sel.value;
  var customs=_dashLoadCustomPresets();
  // Remove previously-rendered custom <option>s, keep the two built-ins.
  Array.prototype.slice.call(sel.querySelectorAll('option')).forEach(function(o){
    if(DASH_BUILTIN_PRESET_IDS.indexOf(o.value)===-1)sel.removeChild(o);
  });
  Object.keys(customs).sort().forEach(function(name){
    var opt=document.createElement('option');
    opt.value='custom:'+name;
    opt.textContent=name;
    sel.appendChild(opt);
  });
  if(Array.prototype.some.call(sel.options,function(o){return o.value===current;}))sel.value=current;
  _dashUpdatePresetDeleteBtn();
}

function _dashUpdatePresetDeleteBtn(){
  var sel=document.getElementById('dash-preset');
  var delBtn=document.getElementById('dash-preset-delete-btn');
  if(!sel||!delBtn)return;
  var isCustom=sel.value.indexOf('custom:')===0;
  delBtn.style.display=(_dashEditing&&isCustom)?'':'none';
}

function saveCurrentAsDashPreset(){
  if(!_dashGrid)return;
  var name=(prompt(T.dash_preset_name_prompt||'Preset name:')||'').trim();
  if(!name)return;
  var customs=_dashLoadCustomPresets();
  customs[name]=_dashGrid.save(false);
  _dashSaveCustomPresets(customs);
  _dashRefreshPresetDropdown();
  var sel=document.getElementById('dash-preset');
  if(sel)sel.value='custom:'+name;
  _dashUpdatePresetDeleteBtn();
}

function deleteCurrentDashPreset(){
  var sel=document.getElementById('dash-preset');
  if(!sel||sel.value.indexOf('custom:')!==0)return;
  var name=sel.value.slice(7);
  if(!confirm((T.dash_preset_delete_confirm||'Delete preset "{name}"?').replace('{name}',name)))return;
  var customs=_dashLoadCustomPresets();
  delete customs[name];
  _dashSaveCustomPresets(customs);
  sel.value='standard';
  _dashRefreshPresetDropdown();
  resetDashLayout();
}

function _dashInjectControls(){
  DASH_CARD_KEYS.forEach(function(key){
    if(_dashHidden.some(function(n){return n.id===key;}))return;
    var content=document.querySelector('#dash-grid .grid-stack-item[gs-id="'+key+'"] .grid-stack-item-content');
    if(!content||content.querySelector('.dash-card-controls'))return;
    var ctrl=document.createElement('div');
    ctrl.className='dash-card-controls';
    var hideBtn=document.createElement('button');
    hideBtn.className='dash-card-ctrl-btn';
    hideBtn.title=T.dash_hide||'Hide';
    hideBtn.textContent='👁';
    hideBtn.addEventListener('click',function(e){e.stopPropagation();dashHideCard(key);});
    ctrl.appendChild(hideBtn);
    content.appendChild(ctrl);
  });
}
function _dashRemoveControls(){
  var nodes=document.querySelectorAll('#dash-grid .dash-card-controls');
  Array.prototype.forEach.call(nodes,function(n){n.parentNode&&n.parentNode.removeChild(n);});
}

function _dashCardLabel(key){
  var card=document.querySelector('[data-card="'+key+'"]');
  if(!card)return key;
  var t=card.querySelector('.card-title');
  return t?t.textContent.trim():key;
}

function _dashRenderHiddenBar(){
  var bar=document.getElementById('dash-hidden-bar');
  if(!bar)return;
  bar.innerHTML='';
  if(!_dashEditing||!_dashHidden.length){bar.classList.remove('show');return;}
  bar.classList.add('show');
  var label=document.createElement('span');
  label.textContent=(T.dash_hidden_cards||'Hidden cards')+': ';
  bar.appendChild(label);
  _dashHidden.forEach(function(n){
    var chip=document.createElement('span');
    chip.className='dash-hidden-chip';
    chip.appendChild(document.createTextNode(_dashCardLabel(n.id)+' '));
    var btn=document.createElement('button');
    btn.textContent='👁';
    btn.title=T.dash_show||'Show';
    btn.addEventListener('click',function(){dashShowCard(n.id);});
    chip.appendChild(btn);
    bar.appendChild(chip);
  });
}

function dashHideCard(key){
  if(_dashHidden.some(function(n){return n.id===key;}))return;
  var item=_dashItem(key);
  if(!item||!_dashGrid)return;
  // Remember position/size so re-show can restore it.
  var n=item.gridstackNode||{};
  _dashHidden.push({id:key,x:n.x,y:n.y,w:n.w,h:n.h});
  _dashGrid.removeWidget(item,false);   // keep DOM element, drop the widget
  item.style.display='none';
  _dashSaveState();
  _dashRenderHiddenBar();
}
function dashShowCard(key){
  var entry=null;
  _dashHidden=_dashHidden.filter(function(n){if(n.id===key){entry=n;return false;}return true;});
  var item=_dashItem(key);
  if(item&&_dashGrid){
    item.style.display='';
    _dashGrid.makeWidget(item);
    if(entry&&entry.w)_dashGrid.update(item,{x:entry.x,y:entry.y,w:entry.w,h:entry.h});
    if(_dashEditing)_dashInjectControls();
  }
  _dashSaveState();
  _dashRenderHiddenBar();
}

function _dashShowAllHidden(){
  _dashHidden.slice().forEach(function(n){dashShowCard(n.id);});
  _dashHidden=[];
}

function resetDashLayout(){
  if(!_dashGrid)return;
  localStorage.removeItem(DASH_STORAGE_KEY);
  var sel=document.getElementById('dash-preset');if(sel)sel.value='standard';
  _dashShowAllHidden();
  _dashGrid.load(DASH_DEFAULT_LAYOUT,false);
  if(_dashEditing){_dashInjectControls();_dashSaveState();}
  _dashRenderHiddenBar();
}
function applyDashPreset(name){
  if(name==='standard'){resetDashLayout();return;}
  if(!_dashGrid)return;
  var layout=null;
  if(name==='wide89'){
    layout=DASH_PRESET_WIDE;
  }else if(name.indexOf('custom:')===0){
    var customs=_dashLoadCustomPresets();
    layout=customs[name.slice(7)];
  }
  if(!layout)return;
  var sel=document.getElementById('dash-preset');
  if(sel)sel.value=name;   // keep the dropdown in sync even when called directly
  _dashShowAllHidden();
  _dashGrid.load(layout,false);
  _dashUpdatePresetDeleteBtn();
  if(_dashEditing)_dashInjectControls();
  _dashSaveState();
  _dashRenderHiddenBar();
}

// Init now — all DASH_* declarations above have run, and app.js loads at
// </body>, so the DOM is ready.
initDashGrid();
// ── Print actions ──
function printAction(a){
  post('/printer/print/'+a,{}).then(function(){clog('Druck: '+a,'msg-ok');poll()})
    .catch(function(e){clog('Fehler: '+e,'msg-err')});
}
function togglePauseResume(){
  // Druckt → pause; Pausiert → resume. Status kommt aus dem zuletzt gepollten
  // print_state in S; bei Unklarheit (kein State) Pause als Default.
  var state=(S && S.print_state)||'';
  if(state==='paused') printAction('resume');
  else                 printAction('pause');
}
function updatePauseResumeBtn(){
  var btn=document.getElementById('d-btn-pause');
  if(!btn) return;
  var state=(S && S.print_state)||'';
  if(state==='paused'){
    btn.textContent=T.btn_resume||'▶ Weiter';
    btn.classList.add('btn-resume');
    btn.classList.remove('btn-pause');
  } else {
    btn.textContent=T.btn_pause||'⏸ Pause';
    btn.classList.add('btn-pause');
    btn.classList.remove('btn-resume');
  }
}
function confirmCancel(){if(confirm(T.confirm_cancel||'Druck wirklich abbrechen?'))printAction('cancel')}

// ── Axis motion ──
// axis codes: 0=X, 1=Y, 2=Z
// move_type 1=relative, distance positive/negative
function getStep(){return currentStep}
function setStep(btn,v){
  currentStep=v;
  document.querySelectorAll('.step-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  var ci=document.getElementById('step-custom');
  if(ci)ci.value='';
}
function setStepCustom(inp){
  var v=parseFloat(inp.value);
  if(!isNaN(v)&&v>0){
    currentStep=v;
    document.querySelectorAll('.step-btn').forEach(b=>b.classList.remove('active'));
  }
}
function move(axis,dir,dist){
  // axis: 0=X,1=Y,2=Z → printer axis codes: 1=X,2=Y,3=Z
  var axisMap={0:1,1:2,2:3};
  post('/api/axis',{axis:axisMap[axis],move_type:1,distance:dir*dist})
    .then(function(){clog('Achse '+(axis===0?'X':axis===1?'Y':'Z')+' '+(dir>0?'+':'')+dir*dist+'mm','msg-ok')})
    .catch(function(e){clog('Achse-Fehler: '+e,'msg-err')});
}
function homeAll(){
  post('/api/axis',{axis:5,move_type:2,distance:0})
    .then(function(){clog('Home All','msg-ok')})
    .catch(function(e){clog('Home-Fehler: '+e,'msg-err')});
}
function homeXY(){
  post('/api/axis',{axis:4,move_type:2,distance:0})
    .then(function(){clog('Home XY','msg-ok')})
    .catch(function(e){clog('Home-Fehler: '+e,'msg-err')});
}
function homeZ(){
  post('/api/axis',{axis:3,move_type:2,distance:0})
    .then(function(){clog('Home Z','msg-ok')})
    .catch(function(e){clog('Home-Fehler: '+e,'msg-err')});
}
function disableMotors(){
  post('/api/axis',{action:'turnOff'})
    .then(function(){clog('Motors Off','msg-ok')})
    .catch(function(e){clog('Motors-Fehler: '+e,'msg-err')});
}

// ── Temperature ──
function setNozzle(){
  var v=parseFloat(document.getElementById('p-nozzle-inp').value||0);
  post('/api/temperature',{nozzle:v,bed:S.bed_target})
    .then(function(){clog('Nozzle → '+v+'°C','msg-ok')})
    .catch(function(e){clog('Temp-Fehler: '+e,'msg-err')});
}
function setBed(){
  var v=parseFloat(document.getElementById('p-bed-inp').value||0);
  post('/api/temperature',{nozzle:S.nozzle_target,bed:v})
    .then(function(){clog(T.label_bed+' → '+v+'°C','msg-ok')})
    .catch(function(e){clog('Temp-Fehler: '+e,'msg-err')});
}

// ── Light ──
function setLight(){
  var on=document.getElementById('d-light-toggle').checked;
  post('/api/light',{on:on,brightness:80})
    .then(function(){clog('Licht '+(on?'an, 80%':'aus'),'msg-ok')})

    .catch(function(e){clog('Licht-Fehler: '+e,'msg-err')});
}

// ── Print Speed ──
function setSpeed(mode){
  S.print_speed_mode=mode;
  [1,2,3].forEach(function(m){
    var b=document.getElementById('d-spd-'+m);
    if(b) b.classList.toggle('spd-active',m===mode);
  });
  post('/api/speed',{mode:mode})
    .catch(function(e){clog('Speed-Fehler: '+e,'msg-err')});
}

// ── Fan ──
function setFan(){
  var v=parseInt(document.getElementById('d-fan').value);
  document.getElementById('d-fan-val').textContent=v;
  post('/api/fan',{speed:v})
    .then(function(){clog('Lüfter → '+v+'%','msg-ok')})
    .catch(function(e){clog('Lüfter-Fehler: '+e,'msg-err')});
}
function quickFan(v){
  document.getElementById('d-fan').value=v;
  document.getElementById('d-fan-val').textContent=v;
  post('/api/fan',{speed:v})
    .then(function(){clog('Lüfter → '+v+'%','msg-ok')})
    .catch(function(e){clog('Lüfter-Fehler: '+e,'msg-err')});
}

// ── AMS ──
function amsFeed(type,slotIndex){
  var globalIdx;
  if(typeof slotIndex==='number'&&slotIndex>=0){
    globalIdx=slotIndex;
  }else{
    var i=parseInt(document.getElementById('ams-slot-sel').value);
    var slot=(window._amsSlots||[])[i]||{};
    globalIdx=slot.global_index!=null?slot.global_index:i;
  }
  return post('/api/ams/feed',{slot_index:globalIdx,type:type})
    .then(function(){clog((type===1?T.lbl_feed:T.lbl_unload)+' Slot '+(globalIdx+1),'msg-ok')})
    .catch(function(e){clog('AMS-Fehler: '+e,'msg-err');throw e;});
}

// ── Camera ──
function camStart(){
  var img=document.getElementById('cam-img');
  var ph=document.getElementById('cam-placeholder');
  var sp=document.getElementById('cam-spinner');
  ph.style.display='none';
  img.style.display='none';
  sp.style.display='block';
  post('/api/camera/start',{}).then(function(){
    camOn=true;
    document.getElementById('cam-toggle-btn').textContent=tr('btn_cam_stop');
    var rb=document.getElementById('cam-reset-btn');if(rb)rb.style.display='';
    clog(tr('log_cam_start'),'msg-ok');
    setTimeout(function(){ sp.style.display='none'; img.style.display='block'; },1200);
    if(/Android/i.test(navigator.userAgent)){
      // Android browsers don't support multipart/x-mixed-replace (MJPEG) — poll snapshots instead
      _camPollInterval=setInterval(function(){ img.src='/api/camera/snapshot?t='+Date.now(); },200);
    } else {
      img.onerror=function(){
        sp.style.display='none';
        img.style.display='none';
        ph.style.display='flex';
        camOn=false;
        document.getElementById('cam-toggle-btn').textContent=tr('btn_cam_start');
        clog(tr('log_error')+' '+tr('cam_stream_unavailable'),'msg-err');
      };
      img.src='/api/camera/stream?t='+Date.now();
    }
  }).catch(function(e){
    sp.style.display='none';
    ph.style.display='flex';
    clog(tr('log_error')+' '+e,'msg-err');
  });
}

function camStop(){
  var img=document.getElementById('cam-img');
  if(_camPollInterval){clearInterval(_camPollInterval);_camPollInterval=null;}
  img.onerror=null; // deregister error handler before clearing src to avoid spurious error toast
  post('/api/camera/stop',{}).catch(function(){});
  img.src='';
  img.style.display='none';
  document.getElementById('cam-placeholder').style.display='flex';
  camOn=false;
  camUserStopped=true; // suppress auto-restart for remainder of this print
  document.getElementById('cam-toggle-btn').textContent=tr('btn_cam_start');
  var rb=document.getElementById('cam-reset-btn');if(rb)rb.style.display='none';
  clog(tr('log_cam_stop'),'msg-ok');
}

function aceDryStart(aceId){
  aceId=(typeof aceId==='number'&&aceId>=0)?aceId:0;
  var prof=_aceDryProfileGet(aceId);
  var t=parseInt(prof.temp,10);
  var d=_aceDryDurationMinFromSec(prof.duration_sec);
  t=Math.max(30,Math.min(80,t));
  d=Math.max(10,Math.min(1440,d));
  return post('/api/ace/dry',{action:'start',target_temp:t,duration:d,ace_id:aceId})
    .then(function(r){return r.json();})
    .then(function(r){
      if(r.error){throw new Error(r.error);}
      clog('ACE '+(aceId+1)+' - '+tr('ace_dry_dryer')+': '+tr('ace_dry_start')+' ('+t+'°C, '+d+' min)','msg-ok');
      poll();
    })
    .catch(function(e){clog('ACE-Fehler: '+e,'msg-err');});
}

var _aceAutoFeedPending={};
function aceAutoRefillToggle(aceId){
  aceId=(typeof aceId==='number'&&aceId>=0)?aceId:0;
  var on=!!((document.getElementById('ace-auto-refill-toggle-'+aceId)||{}).checked);
  _aceAutoFeedPending[aceId]=true;
  fetch('/api/ace/auto_feed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ace_id:aceId,on:on?1:0})})
    .then(function(r){return r.json();})
    .then(function(d){
      delete _aceAutoFeedPending[aceId];
      if(d.error){clog('Auto Refill error: '+d.error,'msg-err');var t=document.getElementById('ace-auto-refill-toggle-'+aceId);if(t)t.checked=!on;return;}
      clog('ACE '+(aceId+1)+' - '+tr('ace_dry_auto_refill')+': '+(on?'ON':'OFF'),'msg-ok');
    })
    .catch(function(e){delete _aceAutoFeedPending[aceId];clog('Auto Refill error: '+e,'msg-err');var t=document.getElementById('ace-auto-refill-toggle-'+aceId);if(t)t.checked=!on;});
}

function openAceDryDialog(aceId){
  aceId=(typeof aceId==='number'&&aceId>=0)?aceId:0;
  _aceDryDialogAceId=aceId;
  _syncAceDryPresetsFromServer(S.ace_dry_presets);
  _aceDryDialogPresetOriginals=JSON.parse(JSON.stringify(ACE_DRY_PRESETS));
  aceDryDialogSyncCustomButtonNames();
  var hasStored=Object.prototype.hasOwnProperty.call(aceDryProfiles,String(aceId));
  var prof=_aceDryProfileGet(aceId);
  if(hasStored&&prof.preset&&ACE_DRY_PRESETS[prof.preset]){
    aceDryDialogPreset(prof.preset);
  }else if(hasStored){
    var sec=prof.duration_sec;
    document.getElementById('ace-dry-dialog-temp').value=prof.temp;
    document.getElementById('ace-dry-dialog-h').value=Math.floor(sec/3600);
    document.getElementById('ace-dry-dialog-m').value=Math.floor((sec%3600)/60);
    document.getElementById('ace-dry-dialog-s').value=sec%60;
    aceDryDialogHighlightPreset('');
  }else{
    aceDryDialogPreset('pla');
  }
  aceDryDialogUpdateSaveButton();
  aceDryDialogUpdateResetButton();
  var sb=document.getElementById('ace-dry-dialog-save-preset');
  if(sb){sb.disabled=false;sb.textContent=tr('ace_dry_dialog_save_restart');}
  document.getElementById('ace-dry-dialog').classList.add('open');
}

function closeAceDryDialog(){
  _aceDryDialogAceId=-1;
  _aceDryDialogPresetOriginals={};
  var sb=document.getElementById('ace-dry-dialog-save-preset');
  if(sb)sb.style.display='none';
  var rb=document.getElementById('ace-dry-dialog-reset-default');
  if(rb)rb.style.display='none';
  document.getElementById('ace-dry-dialog').classList.remove('open');
}

function aceDryDialogIsCustomPreset(key){
  return /^custom_[123]$/.test(String(key||''));
}

function aceDryDialogSyncCustomButtonNames(){
  ['custom_1','custom_2','custom_3'].forEach(function(k){
    var b=document.querySelector('.ace-dry-preset-btn[data-preset="'+k+'"]');
    if(b)b.textContent=(ACE_DRY_PRESETS[k]&&ACE_DRY_PRESETS[k].name)||('Custom '+k.slice(-1));
  });
}

function aceDryDialogUpdateCustomNameUi(){
  var row=document.getElementById('ace-dry-dialog-custom-name-row');
  var input=document.getElementById('ace-dry-dialog-custom-name');
  if(!row||!input)return;
  if(!aceDryDialogIsCustomPreset(_aceDryDialogPresetKey)){
    row.style.display='none';
    return;
  }
  row.style.display='flex';
  input.value=(ACE_DRY_PRESETS[_aceDryDialogPresetKey]&&ACE_DRY_PRESETS[_aceDryDialogPresetKey].name)||'';
}

function aceDryDialogCurrentValues(){
  var t=parseInt(document.getElementById('ace-dry-dialog-temp').value||45,10);
  var h=parseInt(document.getElementById('ace-dry-dialog-h').value||0,10);
  var m=parseInt(document.getElementById('ace-dry-dialog-m').value||0,10);
  var s=parseInt(document.getElementById('ace-dry-dialog-s').value||0,10);
  t=Math.max(30,Math.min(80,t));
  h=Math.max(0,Math.min(24,h));
  m=Math.max(0,Math.min(59,m));
  s=Math.max(0,Math.min(59,s));
  var totalSec=(h*3600)+(m*60)+s;
  totalSec=Math.max(10*60,Math.min(24*3600,totalSec));
  return {temp:t,duration_sec:totalSec};
}

function aceDryDialogUpdateSaveButton(){
  var btn=document.getElementById('ace-dry-dialog-save-preset');
  if(!btn)return;
  var key=_aceDryDialogPresetKey||'';
  if(!key||!ACE_DRY_PRESETS[key]){btn.style.display='none';return;}
  var p=_aceDryDialogPresetOriginals[key]||ACE_DRY_PRESETS[key];
  var cur=aceDryDialogCurrentValues();
  var changed=(cur.temp!==Number(p.temp)||cur.duration_sec!==Number(p.duration_sec));
  if(aceDryDialogIsCustomPreset(key)){
    var nameInp=document.getElementById('ace-dry-dialog-custom-name');
    var n=((nameInp&&nameInp.value)||'').trim();
    var old=(p&&p.name?String(p.name):('Custom '+key.slice(-1))).trim();
    if((n||old)!==old)changed=true;
  }
  btn.style.display=changed?'':'none';
}

function aceDryDialogUpdateResetButton(){
  var btn=document.getElementById('ace-dry-dialog-reset-default');
  if(!btn)return;
  var key=_aceDryDialogPresetKey||'';
  var d=ACE_DRY_PRESET_DEFAULTS[key];
  if(!key||!d){btn.style.display='none';return;}
  var cur=aceDryDialogCurrentValues();
  var changed=(cur.temp!==Number(d.temp)||cur.duration_sec!==Number(d.duration_sec));
  btn.style.display=changed?'':'none';
}

function aceDryDialogInputsChanged(){
  if(aceDryDialogIsCustomPreset(_aceDryDialogPresetKey)){
    var b=document.querySelector('.ace-dry-preset-btn[data-preset="'+_aceDryDialogPresetKey+'"]');
    var i=document.getElementById('ace-dry-dialog-custom-name');
    if(b&&i){
      var t=(i.value||'').trim();
      b.textContent=t||((ACE_DRY_PRESETS[_aceDryDialogPresetKey]&&ACE_DRY_PRESETS[_aceDryDialogPresetKey].name)||('Custom '+_aceDryDialogPresetKey.slice(-1)));
    }
  }
  aceDryDialogUpdateSaveButton();
  aceDryDialogUpdateResetButton();
}

function aceDryDialogHighlightPreset(presetKey){
  _aceDryDialogPresetKey=presetKey||'';
  document.querySelectorAll('.ace-dry-preset-btn').forEach(function(btn){
    var on=(btn.getAttribute('data-preset')===presetKey);
    btn.style.background=on?'var(--accent)':'var(--raised)';
    btn.style.color=on?'#fff':'var(--txt2)';
    btn.style.borderColor=on?'var(--accent)':'var(--border)';
  });
  aceDryDialogUpdateCustomNameUi();
}

function aceDryDialogPreset(presetKey){
  var p=ACE_DRY_PRESETS[presetKey];
  if(!p)return;
  var sec=p.duration_sec;
  document.getElementById('ace-dry-dialog-temp').value=p.temp;
  document.getElementById('ace-dry-dialog-h').value=Math.floor(sec/3600);
  document.getElementById('ace-dry-dialog-m').value=Math.floor((sec%3600)/60);
  document.getElementById('ace-dry-dialog-s').value=sec%60;
  aceDryDialogHighlightPreset(presetKey);
  aceDryDialogSyncCustomButtonNames();
  aceDryDialogUpdateSaveButton();
  aceDryDialogUpdateResetButton();
}

function resetAceDryPresetToDefault(){
  var key=_aceDryDialogPresetKey||'';
  var d=ACE_DRY_PRESET_DEFAULTS[key];
  if(!key||!d)return;
  var sec=Number(d.duration_sec)||0;
  document.getElementById('ace-dry-dialog-temp').value=Number(d.temp)||45;
  document.getElementById('ace-dry-dialog-h').value=Math.floor(sec/3600);
  document.getElementById('ace-dry-dialog-m').value=Math.floor((sec%3600)/60);
  document.getElementById('ace-dry-dialog-s').value=sec%60;
  aceDryDialogInputsChanged();
}

function saveAceDryPresetAndRestart(){
  var key=_aceDryDialogPresetKey||'';
  var btn=document.getElementById('ace-dry-dialog-save-preset');
  if(!key||!ACE_DRY_PRESETS[key]||!btn)return;
  var cur=aceDryDialogCurrentValues();
  if(!ACE_DRY_PRESETS[key])ACE_DRY_PRESETS[key]={};
  ACE_DRY_PRESETS[key].temp=cur.temp;
  ACE_DRY_PRESETS[key].duration_sec=cur.duration_sec;
  if(aceDryDialogIsCustomPreset(key)){
    var nameInp=document.getElementById('ace-dry-dialog-custom-name');
    var nm=((nameInp&&nameInp.value)||'').trim();
    ACE_DRY_PRESETS[key].name=nm||('Custom '+key.slice(-1));
  }
  btn.disabled=true;
  btn.textContent='…';
  fetch(_apiUrl('/api/settings')).then(function(r){return r.json();}).then(function(d){
    d.ace_dry_presets={
      pla:{temp:ACE_DRY_PRESETS.pla.temp,duration_sec:ACE_DRY_PRESETS.pla.duration_sec},
      pla_plus:{temp:ACE_DRY_PRESETS.pla_plus.temp,duration_sec:ACE_DRY_PRESETS.pla_plus.duration_sec},
      petg:{temp:ACE_DRY_PRESETS.petg.temp,duration_sec:ACE_DRY_PRESETS.petg.duration_sec},
      tpu:{temp:ACE_DRY_PRESETS.tpu.temp,duration_sec:ACE_DRY_PRESETS.tpu.duration_sec},
      abs_asa:{temp:ACE_DRY_PRESETS.abs_asa.temp,duration_sec:ACE_DRY_PRESETS.abs_asa.duration_sec},
      pa_pc:{temp:ACE_DRY_PRESETS.pa_pc.temp,duration_sec:ACE_DRY_PRESETS.pa_pc.duration_sec},
      custom_1:{name:ACE_DRY_PRESETS.custom_1.name,temp:ACE_DRY_PRESETS.custom_1.temp,duration_sec:ACE_DRY_PRESETS.custom_1.duration_sec},
      custom_2:{name:ACE_DRY_PRESETS.custom_2.name,temp:ACE_DRY_PRESETS.custom_2.temp,duration_sec:ACE_DRY_PRESETS.custom_2.duration_sec},
      custom_3:{name:ACE_DRY_PRESETS.custom_3.name,temp:ACE_DRY_PRESETS.custom_3.temp,duration_sec:ACE_DRY_PRESETS.custom_3.duration_sec}
    };
    return post('/api/settings',d);
  }).then(function(){
    clog('ACE preset '+key+' '+tr('settings_save'),'msg-ok');
    closeAceDryDialog();
  }).catch(function(e){
    btn.disabled=false;
    btn.textContent=tr('ace_dry_dialog_save_restart');
    clog('ACE-Preset Fehler: '+e,'msg-err');
  });
}

function confirmAceDryDialog(){
  if(_aceDryDialogAceId<0)return;
  var t=parseInt(document.getElementById('ace-dry-dialog-temp').value||45,10);
  var h=parseInt(document.getElementById('ace-dry-dialog-h').value||0,10);
  var m=parseInt(document.getElementById('ace-dry-dialog-m').value||0,10);
  var s=parseInt(document.getElementById('ace-dry-dialog-s').value||0,10);
  t=Math.max(30,Math.min(80,t));
  h=Math.max(0,Math.min(24,h));
  m=Math.max(0,Math.min(59,m));
  s=Math.max(0,Math.min(59,s));
  var totalSec=(h*3600)+(m*60)+s;
  totalSec=Math.max(10*60,Math.min(24*3600,totalSec));
  var preset=_aceDryDialogPresetKey||'';
  _aceDryProfileSet(_aceDryDialogAceId,t,totalSec,preset);
  closeAceDryDialog();
  applyState();
}

function aceDryToggle(aceId,on){
  if(on)return aceDryStart(aceId);
  return aceDryStop(aceId);
}

function toggleCam(){if(camOn)camStop();else camStart()}

function resetCamera(){
  post('/api/camera/reset',{}).then(function(){
    var btn=document.getElementById('cam-reset-btn');
    if(btn){btn.textContent='↻';setTimeout(function(){btn.textContent='↺';},1000);}
  }).catch(function(){});
}

function aceDryStop(aceId){
  aceId=(typeof aceId==='number'&&aceId>=0)?aceId:0;
  return post('/api/ace/dry',{action:'stop',ace_id:aceId})
    .then(function(r){return r.json();})
    .then(function(r){
      if(r.error){throw new Error(r.error);}
      clog('ACE '+(aceId+1)+' - '+tr('ace_dry_dryer')+': '+tr('ace_dry_stop'),'msg-ok');
      poll();
    })
    .catch(function(e){clog('ACE-Fehler: '+e,'msg-err');});
}

function loadStore(){
  fetch(_apiUrl('/kx/files')).then(function(r){return r.json()}).then(function(d){
    storeFiles=d.result||[];
    // Reset any pending selection - stale ids from a deleted/renamed file
    // should never carry over into a fresh file list.
    storeExitSelectMode();
    renderStore();
  }).catch(function(e){clog('Store-Fehler: '+e,'msg-err')});
}

// Applies the store's search/filter/sort controls to storeFiles. Shared by
// renderStore() and storeToggleSelectAll() so "Select All" only selects what
// the user can currently see, not the entire (possibly filtered-out) list.
function _storeFilteredFiles(){
  var q=(document.getElementById('store-search')||{value:''}).value.toLowerCase().trim();
  var filter=(document.getElementById('store-filter')||{value:'all'}).value;
  var sort=(document.getElementById('store-sort')||{value:'date_desc'}).value;

  var files=storeFiles.filter(function(f){
    if(q&&f.filename.toLowerCase().indexOf(q)===-1) return false;
    if(filter==='completed'&&f.last_print_status!=='completed') return false;
    if(filter==='failed'&&(f.last_print_status!=='cancelled'&&f.last_print_status!=='failed')) return false;
    if(filter==='never'&&f.last_print_status) return false;
    return true;
  });

  files.sort(function(a,b){
    if(sort==='name_asc') return a.filename.localeCompare(b.filename);
    if(sort==='duration_asc'){
      var da=a.last_print_duration||a.est_print_time_sec||0;
      var db=b.last_print_duration||b.est_print_time_sec||0;
      return da-db;
    }
    // date_desc (default)
    return (b.uploaded_at||'').localeCompare(a.uploaded_at||'');
  });
  return files;
}

function uploadGcode(file){
  if(!file) return;
  var zone=document.getElementById('store-upload-zone');
  var status=document.getElementById('store-upload-status');
  var label=document.getElementById('store-upload-label');
  // Nur druckbare Dateien zulassen (Issue #59) — Drag&Drop umgeht das
  // accept-Attribut, daher hier explizit prüfen.
  var _fn=(file.name||'').toLowerCase();
  if(!/\.(gcode|gcode\.3mf|3mf|bgcode)$/.test(_fn)){
    if(status){ status.textContent=T.store_upload_only_gcode||'Only GCode files allowed'; status.style.display=''; status.className='upload-status-err'; }
    clog('Upload abgelehnt (kein GCode): '+file.name,'msg-err');
    return;
  }
  if(status) { status.textContent=T.store_upload_busy; status.style.display=''; status.className='upload-status-busy'; }
  if(label) label.style.display='none';
  if(zone) zone.style.pointerEvents='none';
  var fd=new FormData();
  fd.append('file', file);
  fd.append('web_upload', 'true');
  fetch(_apiUrl('/api/files/local'),{method:'POST',body:fd})
    .then(function(r){
      if(!r.ok) return r.text().then(function(t){throw new Error(r.status+': '+t);});
      return r.json();
    })
    .then(function(){
      if(status){ status.textContent=T.store_upload_success.replace('{file}',file.name); status.className='upload-status-ok'; }
      loadStore();
      setTimeout(function(){
        if(status){status.style.display='none'; status.className='';}
        if(label) label.style.display='';
        if(zone) zone.style.pointerEvents='';
      }, 3000);
    })
    .catch(function(e){
      if(status){ status.textContent=T.store_upload_error.replace('{error}',e.message); status.className='upload-status-err'; }
      if(label) label.style.display='';
      if(zone) zone.style.pointerEvents='';
      clog('Upload-Fehler: '+e,'msg-err');
    });
}

function renderStore(){
  var grid=document.getElementById('store-grid');
  var empty=document.getElementById('store-empty');
  var files=_storeFilteredFiles();

  if(!storeFiles.length){
    empty.textContent=T.store_empty;
    grid.innerHTML='';
    empty.style.display='block';
    return;
  }
  if(!files.length){
    empty.textContent=T.store_no_results;
    grid.innerHTML='';
    empty.style.display='block';
    return;
  }
  empty.style.display='none';
  grid.innerHTML=files.map(function(f){
    var thumb=f.thumbnail_b64
      ? '<img src="data:image/png;base64,'+f.thumbnail_b64+'" style="width:100%;height:130px;object-fit:cover;border-radius:6px;display:block;margin-bottom:8px">'
      : '<div style="width:100%;height:130px;background:var(--raised);border-radius:6px;display:flex;align-items:center;justify-content:center;margin-bottom:8px;font-size:32px">🖨</div>';
    var name=f.filename.length>28?f.filename.slice(0,25)+'…':f.filename;
    var date=f.uploaded_at?f.uploaded_at.replace('T',' ').slice(0,16):'';
    var est=f.est_print_time_sec?formatDur(f.est_print_time_sec):'–';
    var statusBadge='';
    var lastInfo='';
    if(f.last_print_status==='completed'){
      statusBadge='<span style="background:#2a7a3b;color:#fff;border-radius:4px;padding:1px 6px;font-size:10px;margin-left:4px">✓</span>';
      if(f.last_print_duration) lastInfo='<div style="font-size:11px;color:var(--ok);margin-bottom:2px">✓ '+formatDur(f.last_print_duration)+'</div>';
    } else if(f.last_print_status==='cancelled'||f.last_print_status==='failed'){
      statusBadge='<span style="background:#a04020;color:#fff;border-radius:4px;padding:1px 6px;font-size:10px;margin-left:4px">✗</span>';
      lastInfo='<div style="font-size:11px;color:var(--err);margin-bottom:2px">✗ '+f.last_print_status+'</div>';
    } else if(!f.last_print_status){
      lastInfo='<div style="font-size:11px;color:var(--txt2);margin-bottom:2px;opacity:.6">'+T.store_never+'</div>';
    }
    var isSelected=!!_storeSelected[f.id];
    var selectBorder=isSelected?'border:2px solid var(--accent);padding:9px':'border:1px solid var(--border);padding:10px';
    // Always visible (not just once select mode is on) - otherwise there is
    // no way to ever enter select mode, since it's normally entered by
    // clicking this very checkbox. White circle behind it so it stays
    // legible against any thumbnail.
    var checkbox='<span style="position:absolute;top:6px;left:6px;width:22px;height:22px;'+
      'border-radius:50%;background:rgba(255,255,255,.85);z-index:2;display:flex;'+
      'align-items:center;justify-content:center">'+
      '<input type="checkbox" class="store-card-cb" '+(isSelected?'checked':'')+
      ' onclick="event.stopPropagation();storeToggleSelect(\''+f.id+'\')" '+
      'style="width:16px;height:16px;margin:0"></span>';
    var cardClick=_storeSelectMode?'onclick="storeToggleSelect(\''+f.id+'\')" style="cursor:pointer;position:relative;background:var(--raised);border-radius:8px;'+selectBorder+';display:flex;flex-direction:column"':
      'style="position:relative;background:var(--raised);border-radius:8px;'+selectBorder+';display:flex;flex-direction:column"';
    return '<div '+cardClick+'>'+
      checkbox+
      thumb+
      '<div title="'+f.filename+'" style="font-size:12px;font-weight:600;margin-bottom:4px;color:var(--txt)">'+name+statusBadge+'</div>'+
      lastInfo+
      '<div style="font-size:11px;color:var(--txt2);margin-bottom:2px">⏱ '+T.store_estimate+': '+est+'</div>'+
      '<div style="font-size:11px;color:var(--txt2);margin-bottom:8px">📅 '+date+'</div>'+
      '<div style="display:flex;gap:6px;margin-top:auto">'+
        '<button onclick="event.stopPropagation();storePrint(\''+f.id+'\',\''+f.filename.replace(/'/g,"\\'")+'\')" '+
          'style="flex:1;font-size:12px;padding:5px;background:var(--accent);color:#fff;border:none;border-radius:6px;cursor:pointer">'+T.store_print+'</button>'+
        '<button onclick="event.stopPropagation();storeDownload(\''+f.id+'\')" title="'+T.store_download+'" '+
          'style="font-size:12px;padding:5px 8px;background:var(--raised);border:1px solid var(--border);border-radius:6px;color:var(--txt2);cursor:pointer">⬇</button>'+
        '<button onclick="event.stopPropagation();storeDelete(\''+f.id+'\')" '+
          'style="font-size:12px;padding:5px 8px;background:var(--raised);border:1px solid var(--border);border-radius:6px;color:var(--txt2);cursor:pointer">🗑</button>'+
      '</div>'+
    '</div>';
  }).join('');

  _storeUpdateSelectBar(files);
}

// Reflects the current selection onto the select-all checkbox (incl.
// indeterminate state), the selected-count label, and the delete button's
// disabled state. `files` is the currently-filtered/visible list.
function _storeUpdateSelectBar(files){
  var selectAll=document.getElementById('store-select-all');
  var countEl=document.getElementById('store-selected-count');
  var delBtn=document.getElementById('store-delete-selected-btn');
  if(!selectAll||!countEl||!delBtn)return;
  var visibleIds=files.map(function(f){return f.id;});
  var selectedVisible=visibleIds.filter(function(id){return _storeSelected[id];});
  var n=selectedVisible.length;
  selectAll.checked=n>0&&n===visibleIds.length;
  selectAll.indeterminate=n>0&&n<visibleIds.length;
  countEl.textContent=n>0?(T.store_selected_count||'{n} selected').replace('{n}',n):'';
  delBtn.disabled=n===0;
}

function formatDur(sec){
  var h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60);
  return h?h+'h '+m+'m':m+'m';
}

var _storeFileId=null;
var _storeFilename=null;
var _filamentDialogMode='store'; // 'store' oder 'banner'
var _pendingWebVerifyFileId=null;
var _pendingWebVerifyFilename='';
var _pendingWebVerifyAction=null;
var _pendingWebVerifyAutoOpen=false;
// GCode-Store-Dateiliste. MUSS deklariert sein – sonst ReferenceError, wenn
// "Slots wählen" im Banner geklickt wird, bevor der Browser-Tab je geladen
// wurde (Issue #29 / Theme-Auslagerung PR #27).
var storeFiles=[];

// Multi-select state for the GCode browser (Issue #94).
var _storeSelectMode=false;
var _storeSelected={};  // file.id -> true

function storeToggleSelect(id){
  if(!_storeSelectMode){
    _storeSelectMode=true;
    var bar=document.getElementById('store-select-bar');
    if(bar)bar.style.display='flex';
  }
  if(_storeSelected[id])delete _storeSelected[id];
  else _storeSelected[id]=true;
  renderStore();
}

function storeToggleSelectAll(checked){
  // Only the currently filtered/visible files are affected, so search/filter
  // never causes "Select All" to silently pick up hidden files too.
  var visible=_storeFilteredFiles();
  _storeSelected={};
  if(checked)visible.forEach(function(f){_storeSelected[f.id]=true;});
  renderStore();
}

function storeExitSelectMode(){
  _storeSelectMode=false;
  _storeSelected={};
  var bar=document.getElementById('store-select-bar');
  if(bar)bar.style.display='none';
  renderStore();
}

function storeDeleteSelected(){
  var ids=Object.keys(_storeSelected);
  if(!ids.length)return;
  if(!confirm((T.store_delete_selected_confirm||'Delete {n} selected files?').replace('{n}',ids.length)))return;
  Promise.all(ids.map(function(id){
    return fetch(_apiUrl('/kx/files/'+id),{method:'DELETE'}).then(function(r){return{id:id,ok:r.ok};});
  })).then(function(results){
    var failed=results.filter(function(r){return !r.ok;});
    if(failed.length)clog((T.log_delete_failed||'Delete failed')+': '+failed.length,'msg-err');
    storeExitSelectMode();
    loadStore();
  });
}

// ── Files on the printer's own internal storage (Issue: 2nd Browser tab) ──
// Uses filename as the identity key (the printer has no numeric file id like
// the bridge's own GCodeStore) and a single batch-delete call, since the
// printer's file/deleteBatch MQTT action natively accepts a filename list.
var printerFiles=[];
var _printerFilesSelectMode=false;
var _printerFilesSelected={};  // filename -> true

function loadPrinterFiles(){
  var errEl=document.getElementById('printer-store-error');
  if(errEl)errEl.style.display='none';
  fetch(_apiUrl('/kx/printer-files')).then(function(r){return r.json()}).then(function(d){
    _printerFilesLoaded=true;
    if(d.error){
      printerFiles=[];
      if(errEl){errEl.textContent=T.printer_store_unreachable||d.error;errEl.style.display='block';}
      renderPrinterFiles();
      return;
    }
    printerFiles=d.result||[];
    _printerFilesSelected={};
    _printerFilesSelectMode=false;
    var bar=document.getElementById('printer-store-select-bar');
    if(bar)bar.style.display='none';
    renderPrinterFiles();
  }).catch(function(e){
    _printerFilesLoaded=true;
    if(errEl){errEl.textContent=T.printer_store_unreachable||String(e);errEl.style.display='block';}
  });
}

function renderPrinterFiles(){
  var grid=document.getElementById('printer-store-grid');
  var empty=document.getElementById('printer-store-empty');
  if(!grid||!empty)return;
  if(!printerFiles.length){
    empty.textContent=T.printer_store_empty||'No files on the printer.';
    grid.innerHTML='';
    empty.style.display='block';
    return;
  }
  empty.style.display='none';
  grid.innerHTML=printerFiles.map(function(f,idx){
    var name=f.filename.length>28?f.filename.slice(0,25)+'…':f.filename;
    var sizeKb=f.size?(f.size/1024).toFixed(0)+' KB':'–';
    var date=f.timestamp?new Date(f.timestamp).toISOString().replace('T',' ').slice(0,16):'';
    var isSelected=!!_printerFilesSelected[f.filename];
    var selectBorder=isSelected?'border:2px solid var(--accent);padding:9px':'border:1px solid var(--border);padding:10px';
    var checkbox='<span style="position:absolute;top:6px;left:6px;width:22px;height:22px;'+
      'border-radius:50%;background:rgba(255,255,255,.85);z-index:2;display:flex;'+
      'align-items:center;justify-content:center">'+
      '<input type="checkbox" class="store-card-cb" '+(isSelected?'checked':'')+
      ' onclick="event.stopPropagation();printerFileToggleSelect(\''+f.filename.replace(/'/g,"\\'")+'\')" '+
      'style="width:16px;height:16px;margin:0"></span>';
    var cardClick=_printerFilesSelectMode?'onclick="printerFileToggleSelect(\''+f.filename.replace(/'/g,"\\'")+'\')" style="cursor:pointer;position:relative;background:var(--raised);border-radius:8px;'+selectBorder+';display:flex;flex-direction:column"':
      'style="position:relative;background:var(--raised);border-radius:8px;'+selectBorder+';display:flex;flex-direction:column"';
    var thumbId='pft-'+idx;
    var cachedThumb=_printerThumbCache[f.filename];
    var thumbHtml=cachedThumb
      ? '<img id="'+thumbId+'" src="data:image/png;base64,'+cachedThumb+'" style="width:100%;height:60px;object-fit:contain;border-radius:6px;background:var(--raised);margin-bottom:8px">'
      : '<div id="'+thumbId+'" data-filename="'+encodeURIComponent(f.filename)+'" style="width:100%;height:60px;background:var(--raised);border-radius:6px;display:flex;align-items:center;justify-content:center;margin-bottom:8px;font-size:28px">🖨</div>';
    return '<div '+cardClick+'>'+
      checkbox+
      thumbHtml+
      '<div title="'+f.filename+'" style="font-size:12px;font-weight:600;margin-bottom:4px;color:var(--txt)">'+name+'</div>'+
      '<div style="font-size:11px;color:var(--txt2);margin-bottom:2px">💾 '+sizeKb+'</div>'+
      '<div style="font-size:11px;color:var(--txt2);margin-bottom:8px">📅 '+date+'</div>'+
      '<div style="display:flex;gap:6px;margin-top:auto">'+
        '<button onclick="event.stopPropagation();printerFileDelete(\''+f.filename.replace(/'/g,"\\'")+'\')" '+
          'style="flex:1;font-size:12px;padding:5px 8px;background:var(--raised);border:1px solid var(--border);border-radius:6px;color:var(--txt2);cursor:pointer">🗑</button>'+
      '</div>'+
    '</div>';
  }).join('');
  _printerFilesUpdateSelectBar();
  _loadVisiblePrinterThumbnails();
}

// Thumbnails are fetched lazily, one at a time, only for cards not already
// cached - fetching all of them upfront would mean one MQTT roundtrip per
// file (145+ files is common), overwhelming the single MQTT connection.
var _printerThumbCache={};  // filename -> base64 PNG string ("" = no thumbnail)
var _printerThumbQueue=[];
var _printerThumbLoading=false;

function _loadVisiblePrinterThumbnails(){
  var placeholders=document.querySelectorAll('#printer-store-grid [data-filename]');
  _printerThumbQueue=Array.prototype.slice.call(placeholders);
  _pumpPrinterThumbQueue();
}

function _pumpPrinterThumbQueue(){
  if(_printerThumbLoading||!_printerThumbQueue.length)return;
  var el=_printerThumbQueue.shift();
  if(!el||!el.isConnected){_pumpPrinterThumbQueue();return;}
  var encodedName=el.getAttribute('data-filename');
  _printerThumbLoading=true;
  fetch(_apiUrl('/kx/printer-files/'+encodedName+'/thumbnail'))
    .then(function(r){return r.json()})
    .then(function(d){
      var thumb=(d.result&&d.result.thumbnail)||'';
      _printerThumbCache[decodeURIComponent(encodedName)]=thumb;
      if(thumb&&el.isConnected){
        var img=document.createElement('img');
        img.src='data:image/png;base64,'+thumb;
        img.style.cssText='width:100%;height:60px;object-fit:contain;border-radius:6px;background:var(--raised);margin-bottom:8px';
        img.id=el.id;
        el.replaceWith(img);
      }
    })
    .catch(function(){/* keep the placeholder icon on failure */})
    .finally(function(){
      _printerThumbLoading=false;
      _pumpPrinterThumbQueue();
    });
}

function _printerFilesUpdateSelectBar(){
  var selectAll=document.getElementById('printer-store-select-all');
  var countEl=document.getElementById('printer-store-selected-count');
  var delBtn=document.getElementById('printer-store-delete-selected-btn');
  if(!selectAll||!countEl||!delBtn)return;
  var allNames=printerFiles.map(function(f){return f.filename;});
  var selected=allNames.filter(function(n){return _printerFilesSelected[n];});
  var n=selected.length;
  selectAll.checked=n>0&&n===allNames.length;
  selectAll.indeterminate=n>0&&n<allNames.length;
  countEl.textContent=n>0?(T.store_selected_count||'{n} selected').replace('{n}',n):'';
  delBtn.disabled=n===0;
}

function printerFileToggleSelect(filename){
  if(!_printerFilesSelectMode){
    _printerFilesSelectMode=true;
    var bar=document.getElementById('printer-store-select-bar');
    if(bar)bar.style.display='flex';
  }
  if(_printerFilesSelected[filename])delete _printerFilesSelected[filename];
  else _printerFilesSelected[filename]=true;
  renderPrinterFiles();
}

function printerFileToggleSelectAll(checked){
  _printerFilesSelected={};
  if(checked)printerFiles.forEach(function(f){_printerFilesSelected[f.filename]=true;});
  renderPrinterFiles();
}

function printerFileExitSelectMode(){
  _printerFilesSelectMode=false;
  _printerFilesSelected={};
  var bar=document.getElementById('printer-store-select-bar');
  if(bar)bar.style.display='none';
  renderPrinterFiles();
}

function _printerFilesDeleteRequest(filenames){
  return fetch(_apiUrl('/kx/printer-files/delete'),{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({filenames:filenames}),
  }).then(function(r){return r.json().then(function(d){return{ok:r.ok,body:d};});});
}

function printerFileDelete(filename){
  if(!confirm(T.printer_store_delete_confirm||'Delete file?'))return;
  _printerFilesDeleteRequest([filename]).then(function(res){
    if(!res.ok){clog((T.log_delete_failed||'Delete failed')+': '+(res.body.error||''),'msg-err');return;}
    loadPrinterFiles();
  });
}

function printerFileDeleteSelected(){
  var names=Object.keys(_printerFilesSelected);
  if(!names.length)return;
  if(!confirm((T.printer_store_delete_selected_confirm||'Delete {n} selected files?').replace('{n}',names.length)))return;
  _printerFilesDeleteRequest(names).then(function(res){
    if(!res.ok){clog((T.log_delete_failed||'Delete failed')+': '+(res.body.error||''),'msg-err');return;}
    printerFileExitSelectMode();
    loadPrinterFiles();
  });
}

var _gcodeFilaments=[];

function _setGcodeFilamentsFromFileObj(fileObj){
  try{
    if(fileObj&&Array.isArray(fileObj.gcode_filaments)){
      _gcodeFilaments=fileObj.gcode_filaments;
    }else if(fileObj&&typeof fileObj.gcode_filaments==='string'&&fileObj.gcode_filaments){
      _gcodeFilaments=JSON.parse(fileObj.gcode_filaments);
    }else{
      _gcodeFilaments=[];
    }
  }catch(e){
    _gcodeFilaments=[];
  }
}

function storePrint(fileId, filename){
  _storeFileId=fileId;
  _storeFilename=filename;
  _filamentDialogMode='store';
  var fileObj=storeFiles.find(function(f){return f.id===fileId;});
  openStorePrintDialog(fileId, filename, fileObj);
}

function openStorePrintDialog(fileId, filename, fileObj){
  _storeFileId=fileId;
  _storeFilename=filename;
  _filamentDialogMode='store';
  maybeGateWebUpload(fileObj, function(){
    // GCode-Filamente aus Store-Datei holen (für Vorschau im Dialog)
    _setGcodeFilamentsFromFileObj(fileObj);
    fetch(_apiUrl('/kx/filament/slots')).then(function(r){return r.json()}).then(function(d){
      openFilamentDialog(d.result||[]);
    }).catch(function(){openFilamentDialog([]);});
  });
}

function webUploadWarningEnabled(){
  return S.web_upload_warning===undefined ? true : !!S.web_upload_warning;
}

function clearWebUploadWarningFlag(fileId, onDone){
  if(!fileId){
    if(onDone) onDone();
    return;
  }
  fetch(_apiUrl('/kx/files/'+encodeURIComponent(fileId)+'/verify'), {method:'POST'})
    .then(function(r){
      if(!r.ok) return r.text().then(function(t){throw new Error(r.status+': '+t);});
      return r.json();
    })
    .then(function(){
      var fileObj=(storeFiles||[]).find(function(f){return f.id===fileId;});
      if(fileObj){fileObj.web_unverified=false;}
      if(onDone) onDone();
      loadStore();
    })
    .catch(function(e){
      clog('Verifizierungs-Fehler: '+e,'msg-err');
    });
}

function maybeGateWebUpload(fileObj, onContinue, opts){
  opts=opts||{};
  if(!fileObj || !fileObj.web_unverified){
    if(onContinue) onContinue();
    return;
  }
  if(!webUploadWarningEnabled()){
    if(onContinue) onContinue();
    return;
  }
  var cancelledId=sessionStorage.getItem('webVerifyCancelledFileId')||'';
  if(opts.autoOpen && cancelledId && cancelledId===String(fileObj.id||'')){
    return;
  }
  openWebVerifyDialog(fileObj.id, fileObj.filename, function(){
    clearWebUploadWarningFlag(fileObj.id, onContinue);
  }, !!opts.autoOpen);
}

function openWebVerifyDialog(fileId, filename, onConfirm, autoOpen){
  _pendingWebVerifyFileId=fileId;
  _pendingWebVerifyFilename=filename;
  _pendingWebVerifyAction=onConfirm||null;
  _pendingWebVerifyAutoOpen=!!autoOpen;
  var status=document.getElementById('store-web-verify-status');
  if(status){status.textContent='';}
  openStoreWebVerifyDialog();
}

function openStoreWebVerifyDialog(){
  var modal=document.getElementById('store-web-verify-dialog');
  if(modal){modal.classList.add('open');}
}

function closeStoreWebVerifyDialog(){
  var modal=document.getElementById('store-web-verify-dialog');
  if(modal){modal.classList.remove('open');}
  if(_pendingWebVerifyAutoOpen && _pendingWebVerifyFileId){
    sessionStorage.setItem('webVerifyCancelledFileId', String(_pendingWebVerifyFileId));
  }
  _pendingWebVerifyFileId=null;
  _pendingWebVerifyFilename='';
  _pendingWebVerifyAction=null;
  _pendingWebVerifyAutoOpen=false;
}

function confirmStoreWebVerify(){
  if(!_pendingWebVerifyFileId||!_pendingWebVerifyFilename){
    closeStoreWebVerifyDialog();
    return;
  }
  var fileId=_pendingWebVerifyFileId;
  var action=_pendingWebVerifyAction;
  var status=document.getElementById('store-web-verify-status');
  if(status){status.textContent='…';}
  fetch(_apiUrl('/kx/files/'+encodeURIComponent(fileId)+'/verify'), {method:'POST'})
    .then(function(r){
      if(!r.ok) return r.text().then(function(t){throw new Error(r.status+': '+t);});
      return r.json();
    })
    .then(function(){
      var fileObj=(storeFiles||[]).find(function(f){return f.id===fileId;});
      if(fileObj){fileObj.web_unverified=false;}
      sessionStorage.removeItem('webVerifyCancelledFileId');
      _pendingWebVerifyFileId=null;
      _pendingWebVerifyFilename='';
      _pendingWebVerifyAction=null;
      _pendingWebVerifyAutoOpen=false;
      closeStoreWebVerifyDialog();
      loadStore();
      if(typeof action==='function') action();
    })
    .catch(function(e){
      if(status){status.textContent='✗ '+e.message;}
      clog('Verifizierungs-Fehler: '+e,'msg-err');
    });
}

function _showMismatchWarn(mismatches){
  var el=document.getElementById('fd-mismatch-warn');
  if(!el)return;
  if(!mismatches||!mismatches.length){el.style.display='none';el.innerHTML='';return;}
  var lines=mismatches.map(function(m){
    var slot='Slot '+(m.slot_index+1);
    if(m.reason==='empty')
      return '⚠ '+slot+': GCode needs '+m.gcode_material+' — slot is empty';
    return '⚠ '+slot+': GCode needs '+m.gcode_material+', loaded: '+(m.ams_material||'?');
  });
  el.innerHTML='<strong>Filament mismatch detected</strong><br>'+lines.join('<br>');
  el.style.display='';
}
function startReadyFileWithSlots(filename,_autoOpen,_mismatch){
  if(!_autoOpen) _fdAutoOpenedFile=null; // manueller Aufruf → Auto-Open-Sperre aufheben
  var fn=filename||S.file_ready;
  var currentFile=(storeFiles||[]).find(function(f){return f.filename===fn;});
  if(currentFile && currentFile.web_unverified && webUploadWarningEnabled()){
    maybeGateWebUpload(currentFile, function(){ startReadyFileWithSlots(fn,_autoOpen); }, {autoOpen:!!_autoOpen});
    return;
  }
  _filamentDialogMode='banner';
  _storeFilename=fn||'';
  // Banner must never reuse stale store-file context.
  _storeFileId=null;
  _gcodeFilaments=[];

  var _autoOpenFile=_autoOpen?fn:null;
  if(_autoOpen) _fdDialogOpen=true; // bereits während Fetch sperren
  function openWithSlots(){
    fetch(_apiUrl('/kx/filament/slots')).then(function(r){return r.json()}).then(function(d){
      if(_autoOpenFile && _fdUserCancelled){_fdDialogOpen=false;return;}
      openFilamentDialog(d.result||[]);
      _showMismatchWarn(_mismatch||null);
    }).catch(function(){
      if(_autoOpenFile && _fdUserCancelled){_fdDialogOpen=false;return;}
      openFilamentDialog([]);
      _showMismatchWarn(_mismatch||null);
    });
  }

  function _proceedWithFileObj(fileObj){
    if(fileObj && fileObj.web_unverified && webUploadWarningEnabled()){
      // Verify-Gate war beim ersten Lookup noch nicht aktiv (storeFiles leer) — jetzt prüfen.
      if(_autoOpen){_fdDialogOpen=false;}
      maybeGateWebUpload(fileObj, function(){ startReadyFileWithSlots(fn,_autoOpen); }, {autoOpen:!!_autoOpen});
      return;
    }
    if(fileObj){
      _storeFileId=fileObj.id;
      _setGcodeFilamentsFromFileObj(fileObj);
    }
    openWithSlots();
  }

  var fileObj=(storeFiles||[]).find(function(f){return f.filename===_storeFilename;});
  if(fileObj){
    _proceedWithFileObj(fileObj);
    return;
  }

  // Fallback: refresh file list, then resolve current file by filename.
  fetch(_apiUrl('/kx/files')).then(function(r){return r.json()}).then(function(d){
    storeFiles=d.result||[];
    var refreshed=(storeFiles||[]).find(function(f){return f.filename===_storeFilename;})||null;
    _proceedWithFileObj(refreshed);
  }).catch(function(){
    openWithSlots();
  });
}

var _amsSlots=[];
var _printObjects=[]; // [{name, skip}] für aktuell offenen Dialog
var _printObjectsSvg=''; // base64-SVG aus DB für Visualisierung

// Hilfsfunktionen für farbige Kanal/Slot-Marker (Issue #23)
function _contrastText(hex){
  // Helle Farbe → dunkler Text, dunkle Farbe → heller Text
  var c=(hex||'').replace('#','');
  if(c.length===3)c=c[0]+c[0]+c[1]+c[1]+c[2]+c[2];
  if(c.length<6)return '#fff';
  var r=parseInt(c.slice(0,2),16),g=parseInt(c.slice(2,4),16),b=parseInt(c.slice(4,6),16);
  // YIQ-Helligkeit
  var y=(r*299 + g*587 + b*114)/1000;
  return y>=140?'#111':'#fff';
}
function _normalizeMaterialKey(material){
  var key=(material||'').toUpperCase().replace(/[^A-Z0-9+]/g,'');
  // Orca often uses PLA for PLA+, while AMS may report PLA+.
  if(key==='PLA+'||key==='PLAPLUS') return 'PLA';
  // Handle modifier+base patterns in either order: "Matte PLA", "Silk PETG",
  // "PLA Silk", "PLA Matte". OrcaSlicer always writes the base type in GCode
  // (filament_type = PLA), but users label slots with the full product-style name.
  var trimmed=(material||'').trim();
  if(trimmed.indexOf(' ')>=0){
    var words=trimmed.toUpperCase().split(/\s+/);
    for(var i=0;i<words.length;i++){
      var w=words[i].replace(/[^A-Z0-9+]/g,'');
      if(_BASE_MATERIAL_TYPES.indexOf(w)>=0) return w;
    }
  }
  return key;
}
function _materialsCompatible(a,b){
  return _normalizeMaterialKey(a)===_normalizeMaterialKey(b);
}
// Issue #57 Punkt 4: konkreter Profilname (User-Override) statt generischem Typ.
// Fällt auf den Material-Typ zurück wenn kein Profil gemappt ist.
function _slotProfileLabel(slot){
  if(!slot)return '';
  if(slot.filament_name){
    return slot.filament_name+(slot.filament_vendor?' — '+slot.filament_vendor:'');
  }
  return slot.material||'';
}
function _escAttr(s){
  return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function _updateSlotMarker(sel){
  var opt=sel.options[sel.selectedIndex];
  var color=opt&&opt.dataset.color?opt.dataset.color:'#888';
  var slotIdx=parseInt(opt.value);
  var paintIdx=sel.dataset.paint;
  var marker=document.querySelector('.fd-slot-marker[data-for-paint="'+paintIdx+'"]');
  if(marker){
    marker.style.background=color;
    marker.style.color=_contrastText(color);
    marker.textContent=(slotIdx+1);
    marker.title=(opt&&opt.dataset.profile)?opt.dataset.profile:'';
  }
}

function openFilamentDialog(slots){
  _amsSlots=slots
    .filter(function(s){return s.status==='loaded';})
    .sort(function(a,b){return (a.slot_index||0)-(b.slot_index||0);});
  _loadSpoolmanStatus();
  var dlg=document.getElementById('filament-dialog');
  var title=document.getElementById('fd-title');
  var body=document.getElementById('fd-slots');
  if(title)title.textContent='▶ '+_storeFilename;
  // Auto-Leveling-Checkbox mit globalem Default vorbelegen
  var fdAl=document.getElementById('fd-auto-leveling');
  if(fdAl) fdAl.checked=(S.auto_leveling===undefined?true:!!S.auto_leveling);
  // Objekt-Liste laden — sobald eine File-ID auflösbar ist (Issue #57 Punkt 3:
  // Skip-Parität auch im Banner-/Upload-Modus, nicht nur im Store-Modus).
  // startReadyFileWithSlots() setzt _storeFileId auch im Banner-Modus per
  // filename→fileObj-Lookup, daher reicht hier die _storeFileId-Prüfung.
  _printObjects=[];
  _printObjectsSvg='';
  var objSection=document.getElementById('fd-objects-section');
  var objBody=document.getElementById('fd-objects-body');
  var objArrow=document.getElementById('fd-objects-arrow');
  if(objSection)objSection.style.display='none';
  if(objBody)objBody.style.display='none';      // immer eingeklappt starten
  if(objArrow)objArrow.style.transform='';
  if(_storeFileId){
    // Bei frischem Orca-/Web-Upload liefert der Drucker die Objektliste
    // (objects_skip_parts) erst per fileDetails nach → ist im Store kurz leer.
    // Daher mehrfach nachfragen, bis Objekte da sind (Issue #57 Skip-Parität).
    var _objFid=_storeFileId;
    var _objTries=0;
    (function _loadObjects(){
      if(_objFid!==_storeFileId) return; // Dialog wechselte Datei → abbrechen
      fetch(_apiUrl('/kx/files/'+encodeURIComponent(_objFid)+'/objects'))
        .then(function(r){return r.json()})
        .then(function(d){
          var names=(d.result&&d.result.names)||[];
          var svg=(d.result&&d.result.svg_b64)||'';
          if(names.length>=2){
            _printObjectsSvg=svg;
            _printObjects=names.map(function(n){return {name:n,skip:false};});
            renderObjectChecklist(); renderObjectSvg();
            var cnt=document.getElementById('fd-objects-count');
            if(cnt)cnt.textContent='('+names.length+')';
            if(objSection)objSection.style.display='block';
          } else if(_objTries++ < 6){
            setTimeout(_loadObjects, 1000); // bis ~6s auf fileDetails warten
          }
        }).catch(function(){});
    })();
  }

  // GCode-Kanäle: bevorzugt aus _gcodeFilaments, sonst aus belegten AMS-Slots ableiten
  var channels=_gcodeFilaments.length?_gcodeFilaments:_amsSlots.map(function(s,i){
    return {slot_index:i,color_hex:s.color_hex,material:s.material};
  });

  // Default mapping strategy:
  // 1) keep order where possible (row i -> nearest compatible slot i)
  // 2) keep defaults unique while compatible slots are available
  // 3) use color proximity as tie-breaker
  function _hexToRgb(hex){
    var c=(hex||'').replace('#','');
    if(c.length===3)c=c[0]+c[0]+c[1]+c[1]+c[2]+c[2];
    if(c.length<6)return [255,255,255];
    return [parseInt(c.slice(0,2),16),parseInt(c.slice(2,4),16),parseInt(c.slice(4,6),16)];
  }
  function _colorDist(a,b){
    var ar=_hexToRgb(a), br=_hexToRgb(b);
    var dr=ar[0]-br[0], dg=ar[1]-br[1], db=ar[2]-br[2];
    return (dr*dr + dg*dg + db*db);
  }
  var defaultSlotByPaint={};
  var usedDefaultSlot={};
  channels.forEach(function(gc,i){
    var compatible=_amsSlots.filter(function(s){
      return _materialsCompatible(gc.material, s.material);
    });
    if(!compatible.length){
      defaultSlotByPaint[i]=-1;
      return;
    }

    var ranked=compatible.slice().sort(function(a,b){
      var da=Math.abs((a.slot_index||0)-i), db=Math.abs((b.slot_index||0)-i);
      if(da!==db)return da-db;
      var ca=_colorDist(gc.color_hex, a.color_hex), cb=_colorDist(gc.color_hex, b.color_hex);
      if(ca!==cb)return ca-cb;
      return (a.slot_index||0)-(b.slot_index||0);
    });

    var chosen=ranked.find(function(s){return !usedDefaultSlot[s.slot_index];}) || ranked[0];
    defaultSlotByPaint[i]=chosen?chosen.slot_index:-1;
    if(chosen) usedDefaultSlot[chosen.slot_index]=1;
  });

  if(!_amsSlots.length){
    body.innerHTML='<p style="color:var(--txt2);font-size:13px;text-align:center;padding:16px 0">'+T.fd_no_slots_msg.replace('{br}','<br>')+'</p>';
  } else {
    body.innerHTML=channels.map(function(gc,i){
      var isUsed=(gc&&gc.is_used!==false);
      // Only allow material-compatible slots.
      var compatible=_amsSlots.filter(function(s){
        return _materialsCompatible(gc.material, s.material);
      });

      var defaultSlotIndex=(defaultSlotByPaint.hasOwnProperty(i)?defaultSlotByPaint[i]:-1);
      var defaultSlot=compatible.find(function(s){return s.slot_index===defaultSlotIndex;})||null;
      var opts=compatible.map(function(s){
        var sel=(defaultSlot&&s.slot_index===defaultSlot.slot_index)?'selected':'';
        return '<option value="'+s.slot_index+'" data-color="'+s.color_hex+'" data-material="'+s.material+'" data-profile="'+_escAttr(_slotProfileLabel(s))+'" '+sel+'>'+
          '● '+T.fd_slot+' '+(s.slot_index+1)+' · '+_slotProfileLabel(s)+'</option>';
      }).join('');
      if(!compatible.length){
        opts='<option value="-1" data-color="#888888" data-material="" selected>⚠ '+T.fd_no_matching_material+'</option>';
      }
      // Kanal-Box (links): farbige Box mit Nummer + auto Kontrast-Text
      var txt=_contrastText(gc.color_hex);
      var slotColor=defaultSlot?defaultSlot.color_hex:'#888';
      var slotTxt=_contrastText(slotColor);
      var usedBadge=isUsed
        ? '<span style="font-size:10px;color:var(--ok);font-weight:700;min-width:32px">'+T.fd_used+'</span>'
        : '<span style="font-size:10px;color:var(--txt2);font-weight:700;min-width:32px;opacity:.75">'+T.fd_used+'</span>';
      return '<div style="display:flex;align-items:center;gap:8px;padding:8px;border-radius:6px;background:var(--raised);border:1px solid var(--border)">'+
        '<span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:6px;background:'+gc.color_hex+';color:'+txt+';font-weight:700;font-size:13px;border:1px solid var(--border);flex-shrink:0">'+(i+1)+'</span>'+
        '<span style="font-size:11px;color:var(--txt2);min-width:36px">'+gc.material+'</span>'+
        usedBadge+
        '<span style="font-size:16px;color:var(--txt2)">→</span>'+
        '<span class="fd-slot-marker" data-for-paint="'+i+'" title="'+_escAttr(defaultSlot?_slotProfileLabel(defaultSlot):'')+'" style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:5px;background:'+slotColor+';color:'+slotTxt+';font-weight:700;font-size:12px;border:1px solid var(--border);flex-shrink:0">'+(defaultSlot?defaultSlot.slot_index+1:'?')+'</span>'+
        '<select data-paint="'+i+'" data-paint-color="'+gc.color_hex+'" data-is-used="'+(isUsed?'1':'0')+'" data-has-compatible="'+(compatible.length?'1':'0')+'" '+(compatible.length?'':'disabled')+' onchange="_updateSlotMarker(this)" style="flex:1;min-width:0;padding:4px 6px;border-radius:6px;border:1px solid var(--border);background:var(--raised);color:var(--txt);font-size:12px">'+
        opts+'</select>'+
      '</div>';
    }).join('');
  }
  if(dlg)dlg.classList.add('open');
  // Spoolman-Section nach Slot-Render aufbauen (braucht die selects im DOM)
  setTimeout(_buildSpoolmanSection, 0);
}

function closeFilamentDialog(){
  var dlg=document.getElementById('filament-dialog');
  if(dlg)dlg.classList.remove('open');
  _showMismatchWarn(null);
  _fdDialogOpen=false;
  if(_fdAutoOpenedFile){
    _fdUserCancelled=true;
    sessionStorage.setItem('fdUserCancelled','1');
    sessionStorage.setItem('fdAutoOpenedFile',_fdAutoOpenedFile);
  }
}

function confirmFilamentPrint(){
  var selects=document.querySelectorAll('#fd-slots select');
  var assignments=[];
  var missingCompatible=0;
  selects.forEach(function(sel){
    var paintIdx=parseInt(sel.dataset.paint);
    var paintColor=sel.dataset.paintColor;
    var isUsed=(sel.dataset.isUsed==='1');
    var hasCompatible=(sel.dataset.hasCompatible==='1');
    var opt=sel.options[sel.selectedIndex];
    var amsIdx=parseInt(opt&&opt.value);
    if(!hasCompatible || Number.isNaN(amsIdx) || amsIdx < 0){
      if(isUsed) missingCompatible += 1;
      amsIdx = -1;
    }
    var amsSlot=_amsSlots.find(function(s){return s.slot_index===amsIdx;})||{};
    // Farbe als [R,G,B,255]
    function hexToRgba(h){
      var c=h.replace('#','');
      if(c.length===3)c=c[0]+c[0]+c[1]+c[1]+c[2]+c[2];
      return [parseInt(c.slice(0,2),16),parseInt(c.slice(2,4),16),parseInt(c.slice(4,6),16),255];
    }
    assignments.push({
      paint_index:  paintIdx,
      is_used:      isUsed,
      slot_index:   amsIdx,
      material:     opt.dataset.material||'PLA',
      paint_color:  hexToRgba(paintColor||'#ffffff'),
      ams_color:    hexToRgba(amsSlot.color_hex||'#ffffff'),
    });
  });
  if(missingCompatible>0){
    clog('Cannot start print: '+missingCompatible+' used paint(s) have no matching material slot','msg-err');
    return;
  }
  // Pre-Print Skip: Namen der abgehakten Objekte sammeln
  var excludedObjects=_printObjects.filter(function(o){return o.skip;}).map(function(o){return o.name;});
  var fdAlEl=document.getElementById('fd-auto-leveling');
  var fdAutoLeveling=fdAlEl?( fdAlEl.checked?1:0):(S.auto_leveling===undefined?1:S.auto_leveling?1:0);
  // Spoolman: Slot→Spool-Mapping aus Dialog sammeln und senden
  if(_spoolmanStatus.configured){
    var slotMap={};
    document.querySelectorAll('[data-spool-slot]').forEach(function(sel){
      var idx=sel.dataset.spoolSlot;
      var val=parseInt(sel.value);
      if(val>0)slotMap[idx]=val;
    });
    _slotSpoolMap=slotMap;
    post('/kx/spoolman/active-spool',{slot_map:slotMap}).catch(function(){});
  }
  closeFilamentDialog();
  if(_filamentDialogMode==='banner'){
    // Banner-Modus: /kx/print bevorzugen wenn _storeFileId bekannt (gleicher Pfad wie File-Browser).
    var btn=document.getElementById('file-ready-btn');
    if(btn){btn.disabled=true;btn.textContent='…';}
    var startPromise;
    if(_storeFileId){
      startPromise=fetch(_apiUrl('/kx/print'),{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          file_id:_storeFileId,
          filament_assignments:assignments,
          excluded_objects:excludedObjects,
          auto_leveling:fdAutoLeveling
        })
      });
    }else{
      startPromise=post('/printer/print/start',{
        filename:S.file_ready||_storeFilename,
        filament_assignments:assignments,
        excluded_objects:excludedObjects,
        auto_leveling:fdAutoLeveling
      });
    }
    startPromise.then(function(r){
      if(!r.ok){return r.text().then(function(t){throw new Error(t||('HTTP '+r.status));});}
      return r.json();
    }).then(function(d){
      if(d&&d.error) throw new Error(d.error);
      if(d&&d.result&&d.result!=='ok') throw new Error(String(d.result));
      document.getElementById('file-ready-banner').style.display='none';
      if(btn){btn.disabled=false;setText('file-ready-btn',T.file_ready_btn);}
    }).catch(function(e){
      clog(tr('log_error')+' '+e,'msg-err');
      if(btn){btn.disabled=false;setText('file-ready-btn',T.file_ready_btn);}
    });
  } else {
    // Store-Modus: POST /kx/print
    fetch(_apiUrl('/kx/print'),{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({file_id:_storeFileId,filament_assignments:assignments,excluded_objects:excludedObjects,auto_leveling:fdAutoLeveling})
    }).then(function(r){return r.json()}).then(function(d){
      if(d.result==='ok'){clog('Druckstart: '+_storeFilename,'msg-ok');showPanel('dashboard');}
      else{clog('Druckfehler: '+(d.error||'?'),'msg-err');}
    }).catch(function(e){clog('Druckfehler: '+e,'msg-err');});
  }
}

function renderObjectChecklist(){
  var box=document.getElementById('fd-objects');
  if(!box)return;
  box.innerHTML=_printObjects.map(function(o,i){
    var label=o.name;
    // Klipper-Namen sind oft "Datei.stl_id_N_copy_M" → schöner darstellen
    var m=label.match(/^(.+)\.stl_id_(\d+)_copy_(\d+)$/);
    if(m)label=m[1]+' #'+(parseInt(m[2])+1)+(m[3]!=='0'?' ('+(parseInt(m[3])+1)+')':'');
    return '<label style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;background:var(--raised);border:1px solid var(--border);cursor:pointer;font-size:12px">'+
      '<input type="checkbox" data-idx="'+i+'" '+(o.skip?'checked':'')+' onchange="_toggleObjectSkip('+i+',this.checked)">'+
      '<span style="word-break:break-all">'+label+'</span>'+
      '</label>';
  }).join('');
}
function _toggleObjectSkip(idx,val){
  if(_printObjects[idx])_printObjects[idx].skip=!!val;
  renderObjectSvg();
}
// Issue #57 Punkt 3: Skip-Objekte-Bereich ein-/ausklappen
function toggleFdObjects(){
  var body=document.getElementById('fd-objects-body');
  var arrow=document.getElementById('fd-objects-arrow');
  if(!body)return;
  var open=body.style.display!=='none';
  body.style.display=open?'none':'block';
  if(arrow)arrow.style.transform=open?'':'rotate(90deg)';
}
function renderObjectSvg(){
  var box=document.getElementById('fd-objects-svg');
  if(!box)return;
  if(!_printObjectsSvg||!_printObjects.length){box.style.display='none';box.innerHTML='';return;}
  box.style.display='block';
  var svg=''; try{ svg=atob(_printObjectsSvg);}catch(e){ box.style.display='none'; return; }
  box.innerHTML=svg;
  var svgEl=box.querySelector('svg');
  if(!svgEl)return;
  svgEl.style.width='100%'; svgEl.style.maxHeight='200px'; svgEl.style.height='auto';
  _printObjects.forEach(function(o,i){
    var g=svgEl.querySelector('g[id="'+CSS.escape(o.name)+'"]');
    if(!g)return;
    var path=g.querySelector('path');
    g.style.cursor='pointer';
    g.setAttribute('opacity', o.skip?'0.8':'0.35');
    if(path){
      path.setAttribute('fill', o.skip?'#ff5e5b':'#5fa7ff');
      path.setAttribute('fill-opacity', o.skip?'0.4':'0.18');
    }
    g.onclick=function(){
      _printObjects[i].skip=!_printObjects[i].skip;
      renderObjectChecklist(); renderObjectSvg();
    };
  });
}

// ── Mid-Print Skip ──
var _skipObjects=[]; // [{name, skipped, willSkip}]
var _skipSvg='';
var _skipPollTimer=null;
function _applySkipDialogState(s){
  s=s||{};
  _skipSvg=s.svg_b64||'';
  var skipped=s.skipped||[];
  // Pending-Auswahl (willSkip) beim Refresh erhalten.
  var prevWillSkip={};
  (_skipObjects||[]).forEach(function(o){if(o&&o.name)prevWillSkip[o.name]=!!o.willSkip;});
  _skipObjects=(s.objects||[]).map(function(n){
    var isSkipped=(skipped.indexOf(n)>=0);
    return {name:n, skipped:isSkipped, willSkip:isSkipped?false:!!prevWillSkip[n]};
  });
  renderSkipList(); renderSkipSvg();
}
function openSkipDialog(){
  document.getElementById('skip-status').textContent='';
  document.getElementById('skip-confirm').disabled=false;
  _refreshSkipDialog();
  if(_skipPollTimer)clearInterval(_skipPollTimer);
  _skipPollTimer=setInterval(function(){
    var dlg=document.getElementById('skip-dialog');
    if(!(dlg&&dlg.classList.contains('open')))return;
    _refreshSkipDialog();
  },2000);
  document.getElementById('skip-dialog').classList.add('open');
}
function _refreshSkipDialog(){
  // query-Endpoint wartet intern auf frischen skip/report (bis 1.5s).
  fetch(_apiUrl('/kx/skip/query'),{method:'POST'})
    .then(function(r){return r.json();})
    .then(function(d){_applySkipDialogState(d.result||{});})
    .catch(function(){
      fetch(_apiUrl('/kx/skip/state')).then(function(r){return r.json();}).then(function(d){
        _applySkipDialogState(d.result||{});
      }).catch(function(){});
    });
}
function closeSkipDialog(){
  if(_skipPollTimer){clearInterval(_skipPollTimer);_skipPollTimer=null;}
  document.getElementById('skip-dialog').classList.remove('open');
}
function _shortLabel(name){
  var m=name.match(/^(.+)\.[sS][tT][lL]_id_(\d+)_copy_(\d+)$/);
  if(!m)return name;
  return m[1]+' #'+(parseInt(m[2])+1)+(m[3]!=='0'?' ('+(parseInt(m[3])+1)+')':'');
}
function renderSkipList(){
  var box=document.getElementById('skip-list');
  if(!box)return;
  if(!_skipObjects.length){
    box.innerHTML='<div style="color:var(--txt2);font-size:12px;padding:12px;text-align:center">'+tr('skip_no_objects')+'</div>';
    return;
  }
  box.innerHTML=_skipObjects.map(function(o,i){
    var label=_shortLabel(o.name);
    var dis=o.skipped?'disabled':'';
    var note=o.skipped?'<span style="font-size:11px;color:var(--warn);margin-left:auto">'+tr('skip_already')+'</span>':'';
    return '<label style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;background:var(--raised);border:1px solid var(--border);font-size:12px;'+(o.skipped?'opacity:0.5':'')+'">'+
      '<input type="checkbox" data-idx="'+i+'" '+(o.willSkip?'checked':'')+' '+dis+' onchange="_toggleWillSkip('+i+',this.checked)">'+
      '<span style="word-break:break-all">'+label+'</span>'+note+
      '</label>';
  }).join('');
}
function renderSkipSvg(){
  var box=document.getElementById('skip-svg');
  if(!box)return;
  if(!_skipSvg||!_skipObjects.length){box.style.display='none';box.innerHTML='';return;}
  box.style.display='block';
  // SVG aus base64 dekodieren
  var svg='';
  try{ svg=atob(_skipSvg); }catch(e){ box.style.display='none'; return; }
  box.innerHTML=svg;
  // Polygone interaktiv machen: jeder <g id="..."> entspricht einem Objekt
  var svgEl=box.querySelector('svg');
  if(!svgEl)return;
  svgEl.style.width='100%'; svgEl.style.maxHeight='280px'; svgEl.style.height='auto';
  _skipObjects.forEach(function(o,i){
    var g=svgEl.querySelector('g[id="'+CSS.escape(o.name)+'"]');
    if(!g)return;
    var path=g.querySelector('path');
    if(o.skipped){
      // bereits übersprungen → ausgegraut, kein Klick
      g.setAttribute('opacity','0.25');
      if(path){path.setAttribute('fill','#888');path.setAttribute('fill-opacity','0.3');}
      g.style.cursor='not-allowed';
    } else {
      g.style.cursor='pointer';
      g.setAttribute('opacity', o.willSkip?'0.8':'0.35');
      if(path){
        path.setAttribute('fill', o.willSkip?'#ff5e5b':'#5fa7ff');
        path.setAttribute('fill-opacity', o.willSkip?'0.4':'0.18');
      }
      g.onclick=function(){
        _skipObjects[i].willSkip=!_skipObjects[i].willSkip;
        renderSkipList(); renderSkipSvg();
      };
    }
  });
}
function _toggleWillSkip(idx,val){
  if(_skipObjects[idx])_skipObjects[idx].willSkip=!!val;
  renderSkipSvg();
}
function confirmSkip(){
  var names=_skipObjects.filter(function(o){return o.willSkip;}).map(function(o){return o.name;});
  var st=document.getElementById('skip-status');
  var btn=document.getElementById('skip-confirm');
  if(!names.length){st.textContent=tr('skip_select_at_least_one');st.style.color='var(--warn)';return;}
  btn.disabled=true; st.textContent=tr('skip_sending'); st.style.color='var(--txt2)';
  fetch(_apiUrl('/kx/skip'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({names:names})})
    .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})
    .then(function(res){
      if(!res.ok){st.textContent=(res.j&&res.j.error)||'Fehler';st.style.color='var(--err)';btn.disabled=false;return;}
      st.textContent=tr('skip_success');st.style.color='var(--ok)';
      // Dialog offen lassen + neu laden damit der "übersprungen"-Status erscheint
      setTimeout(function(){ _refreshSkipDialog(); btn.disabled=false; st.textContent=''; }, 1500);
    })
    .catch(function(e){st.textContent=''+e;st.style.color='var(--err)';btn.disabled=false;});
}

function storeDelete(fileId){
  if(!confirm(T.store_delete_confirm)) return;
  fetch(_apiUrl('/kx/files/'+fileId),{method:'DELETE'}).then(function(r){
    if(r.ok){loadStore();}
    else{clog('Löschen fehlgeschlagen','msg-err');}
  });
}

function storeDownload(fileId){
  var a=document.createElement('a');
  a.href=_apiUrl('/kx/files/'+encodeURIComponent(fileId)+'/download');
  a.style.display='none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ── Drucker hinzufügen ──
function openAddPrinterDialog(){
  document.getElementById('apd-ip').value='';
  document.getElementById('apd-name').value='';
  var st=document.getElementById('apd-status');st.textContent='';st.style.color='var(--txt2)';
  document.getElementById('apd-confirm').disabled=false;
  document.getElementById('add-printer-dialog').classList.add('open');
}
function closeAddPrinterDialog(){
  document.getElementById('add-printer-dialog').classList.remove('open');
}
function confirmAddPrinter(){
  var ip=document.getElementById('apd-ip').value.trim();
  var name=document.getElementById('apd-name').value.trim();
  var st=document.getElementById('apd-status'),btn=document.getElementById('apd-confirm');
  if(!ip){st.textContent=T.apd_err_ip;st.style.color='var(--err)';return;}
  st.textContent=T.apd_fetching;st.style.color='var(--txt2)';btn.disabled=true;
  fetch('/kx/printers/add',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({printer_ip:ip,name:name})})
    .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})
    .then(function(res){
      if(!res.ok){st.textContent=(res.j&&res.j.error)||'Fehler';st.style.color='var(--err)';btn.disabled=false;return;}
      st.textContent=T.apd_success;st.style.color='var(--ok)';
      setTimeout(function(){location.reload();},2500);
    })
    .catch(function(e){st.textContent=''+e;st.style.color='var(--err)';btn.disabled=false;});
}
function removePrinter(id,name){
  if(!confirm(T.printers_remove_confirm.replace('{name}',name)))return;
  fetch('/kx/printers/'+encodeURIComponent(id),{method:'DELETE'})
    .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})
    .then(function(res){
      if(!res.ok){alert((res.j&&res.j.error)||'Fehler');return;}
      setTimeout(function(){location.href='/printer1';},2000);
    })
    .catch(function(e){alert(''+e);});
}

// ── Drucker-Tab ──
function loadPrinterTab(){
  var grid=document.getElementById('printers-grid');
  if(grid)grid.innerHTML='<div style="color:var(--txt2);font-size:13px;padding:20px">'+T.printers_loading+'</div>';
  // Drucker-Liste von lokaler Instanz holen
  fetch('/kx/printers').then(function(r){return r.json()}).then(function(d){
    var printers=d.result||[];
    if(!printers.length){
      if(grid)grid.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:40px 20px;color:var(--txt2)">'+
        '<div style="font-size:32px;margin-bottom:8px">🖨</div>'+
        '<div style="font-size:14px;margin-bottom:14px">'+T.printers_empty_hint+'</div>'+
        '<button onclick="openAddPrinterDialog()" style="font-size:13px;padding:8px 18px;background:var(--accent);border:none;border-radius:8px;color:#fff;cursor:pointer;font-weight:600">+ '+T.add_printer+'</button>'+
      '</div>';
      return;
    }
    // Status jedes Druckers parallel abrufen
    var fetches=printers.map(function(p){
      var url=(p.bridge_url||'').replace(/\/+$/,'');
      return fetch(url+'/api/state',{signal:AbortSignal.timeout(3000)})
        .then(function(r){return r.json()})
        .then(function(s){return {printer:p,state:s,online:true};})
        .catch(function(){return {printer:p,state:{},online:false};});
    });
    Promise.all(fetches).then(function(results){
      var activeId=_activePrinter?String(_activePrinter.id):null;
      if(grid)grid.innerHTML=results.map(function(res){
        var p=res.printer,s=res.state,online=res.online;
        var isActive=String(p.id)===activeId;
        var url=(p.bridge_url||'').replace(/\/+$/,'');
        var printerNum=p.id;
        var ks=online?(s.kobra_state||'free'):'offline';
        var stateKey='kobra_'+ks;
        var stateLabel=T[stateKey]||ks;
        var stateColor=ks==='free'?'var(--ok)':ks==='printing'?'var(--accent)':ks==='offline'?'var(--txt2)':'var(--warn)';
        var progress=online&&s.progress?Math.round(s.progress*100):null;
        var filename=online&&s.filename?s.filename:'';
        var nt=online&&s.nozzle_temp?s.nozzle_temp.toFixed(1):'–';
        var bt=online&&s.bed_temp?s.bed_temp.toFixed(1):'–';
        var border=isActive?'2px solid var(--accent)':'1px solid var(--border)';
        var nameEsc=String(p.name).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        return '<div style="background:var(--raised);border:'+border+';border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:8px">'+
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">'+
            '<span style="font-weight:700;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">🖨 '+p.name+'</span>'+
            '<span style="display:flex;align-items:center;gap:8px;flex-shrink:0">'+
              (isActive?'<span style="font-size:11px;color:var(--accent);font-weight:600">'+T.printers_active+'</span>':'')+
              (p.has_power_control?'<button id="power-btn-'+printerNum+'" onclick="togglePrinterPower(\''+printerNum+'\')" title="'+T.printers_power+'" style="background:none;border:none;color:var(--txt2);font-size:16px;cursor:pointer;line-height:1;padding:0">🔌</button>':'')+
              '<button onclick="removePrinter(\''+printerNum+'\',\''+nameEsc+'\')" title="'+T.printers_remove+'" style="background:none;border:none;color:var(--txt2);font-size:16px;cursor:pointer;line-height:1;padding:0">✕</button>'+
            '</span>'+
          '</div>'+
          '<div style="display:flex;align-items:center;gap:6px">'+
            '<span style="width:8px;height:8px;border-radius:50%;background:'+stateColor+';display:inline-block"></span>'+
            '<span style="font-size:13px;color:var(--txt2)">'+stateLabel+'</span>'+
          '</div>'+
          (p.printer_ip?'<div style="font-size:12px;color:var(--txt2)">🌐 '+p.printer_ip+'</div>':'')+
          (filename?'<div style="font-size:12px;color:var(--txt2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="'+filename+'">📄 '+filename+'</div>':'')+
          (progress!==null?'<div style="background:var(--border);border-radius:4px;height:6px;overflow:hidden"><div style="background:var(--accent);height:100%;width:'+progress+'%"></div></div>':'')+
          '<div style="font-size:12px;color:var(--txt2);display:flex;gap:12px">'+
            '<span>🌡 '+nt+'°C</span><span>🛏 '+bt+'°C</span>'+
          '</div>'+
          (!isActive?'<a href="'+url+'/printer'+printerNum+'" style="display:block;text-align:center;padding:7px;background:var(--accent);color:#fff;border-radius:7px;font-size:13px;font-weight:600;text-decoration:none;margin-top:4px">'+T.printers_switch+'</a>':'<div style="text-align:center;padding:7px;font-size:12px;color:var(--txt2)">'+T.printers_current+'</div>')+
        '</div>';
      }).join('');
      results.forEach(function(res){
        if(res.printer.has_power_control)_refreshPrinterPowerIcon(res.printer.id,(res.printer.bridge_url||'').replace(/\/+$/,''));
      });
    });
  }).catch(function(e){
    if(grid)grid.innerHTML='<div style="color:var(--err);font-size:13px;padding:20px">Fehler: '+e+'</div>';
  });
}

function _refreshPrinterPowerIcon(pid,bridgeUrl){
  fetch((bridgeUrl||'')+'/kx/printers/'+encodeURIComponent(pid)+'/power-status',{signal:AbortSignal.timeout(5000)})
    .then(function(r){return r.json()})
    .then(function(d){
      var btn=document.getElementById('power-btn-'+pid);
      if(!btn)return;
      if(d.state==='on'){btn.style.color='var(--ok)';btn.title=T.printers_power_on||'Power: On';}
      else if(d.state==='off'){btn.style.color='var(--txt2)';btn.title=T.printers_power_off||'Power: Off';}
    })
    .catch(function(){/* status endpoint optional - icon just stays neutral */});
}

function togglePrinterPower(pid){
  var btn=document.getElementById('power-btn-'+pid);
  var currentlyOn=btn&&btn.style.color&&btn.style.color.indexOf('var(--ok)')!==-1;
  // Without a known current state, default to "on" - turning an already-off
  // switch on is harmless, whereas guessing "off" on a printer mid-print is not.
  var action=currentlyOn?'off':'on';
  if(action==='off'&&!confirm(T.printers_power_off_confirm||'Turn printer power off? Make sure no print is running.'))return;
  if(btn)btn.style.opacity='0.5';
  post('/kx/printers/'+encodeURIComponent(pid)+'/power',{action:action}).then(function(){
    if(btn)btn.style.opacity='1';
    setTimeout(function(){loadPrinterTab();},1500);
  }).catch(function(e){
    if(btn)btn.style.opacity='1';
    clog('Power-Fehler: '+e,'msg-err');
  });
}
