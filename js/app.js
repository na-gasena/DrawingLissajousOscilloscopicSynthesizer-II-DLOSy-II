/**
 * DLOSy20 - Main Application
 * Initializes all modules and handles global state
 */

document.addEventListener('DOMContentLoaded', () => {
  console.log('DLOSy20 Web Synthesizer - Initializing...');

  // Initialize UI Components (knobs, keyboard, buttons)
  uiComponents.init();

  // Initialize ADSR Envelope Curve Editor
  adsrEditor.init();

  // Initialize Step Sequencer
  stepSequencer.init();

  // Initialize Drum Machine
  drumMachine.init();

  // Initialize VCO Loop
  vcoLoop.init();

  // Initialize Drawing Mode
  drawingMode.init();

  // Initialize MIDI OUT
  if (window.midiOut) {
    midiOut.init();
  }

  // Initialize Unim Search
  if (window.unimSearch) {
    unimSearch.init();
  }

  // Initialize Effects Engine
  if (window.effectsEngine) {
    effectsEngine.init();
  }

  // Initialize CV Clock Sync
  if (window.cvClock) {
    cvClock.init();
  }

  // Initialize MIDI IN
  if (window.midiIn) {
    midiIn.init();
  }

  // Initialize Preset Manager (save/load)
  if (window.presetManager) {
    presetManager.init();
  }

  // Initialize Audio Settings
  if (window.audioSettings) {
    audioSettings.init();
  }

  // Initialize Arpeggiator
  if (window.arpeggiator) {
    arpeggiator.init();
  }

  // ===== Left panel tab switching (SYNTH / SETTINGS) =====
  function switchLeftTab(tabName) {
    document.querySelectorAll('.left-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.left-tab-content').forEach(c => c.classList.remove('active'));
    const tab = document.querySelector(`.left-tab[data-left-tab="${tabName}"]`);
    const content = document.getElementById(`left-tab-${tabName}`);
    if (tab) tab.classList.add('active');
    if (content) content.classList.add('active');
  }

  document.querySelectorAll('.left-tab').forEach(tab => {
    tab.addEventListener('click', () => switchLeftTab(tab.dataset.leftTab));
  });

  // ===== Center panel tab switching + left panel sync =====
  function onCenterTabSwitch(target) {
    // Update center tab buttons
    document.querySelectorAll('.center-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.center-tab-content').forEach(c => c.classList.remove('active'));
    const tabBtn = document.querySelector(`.center-tab[data-tab="${target}"]`);
    const content = document.getElementById(`center-tab-${target}`);
    if (tabBtn) tabBtn.classList.add('active');
    if (content) content.classList.add('active');

    // Left panel: show SYNTH tab only when SEQUENCER is active
    const synthTab = document.querySelector('.left-tab[data-left-tab="synth"]');
    if (target === 'sequencer') {
      if (synthTab) synthTab.style.display = '';
      switchLeftTab('synth');
    } else {
      if (synthTab) synthTab.style.display = 'none';
      switchLeftTab('settings');
    }

    // Redraw ARP ADSR canvas after tab becomes visible (resize sync)
    if (window.arpeggiator && target === 'arp') {
      requestAnimationFrame(() => {
        if (arpeggiator.drawAdsrCurve) arpeggiator.drawAdsrCurve();
      });
    }
  }

  document.querySelectorAll('.center-tab').forEach(tab => {
    tab.addEventListener('click', () => onCenterTabSwitch(tab.dataset.tab));
  });

  // ===== Track Active Panel (Center vs VCO Loop) =====
  let isVcoActive = false;
  document.addEventListener('pointerdown', (e) => {
    // If click is within vco-loop-panel, mark VCO as active
    if (e.target.closest('#vco-loop-panel')) {
      isVcoActive = true;
    } 
    // If click is within center panel, mark Center as active (VCO inactive)
    else if (e.target.closest('#panel-center')) {
      isVcoActive = false;
    }
  });

  // Tab key to switch between SEQUENCER / DRUMS / ARP / GLYPH tabs OR VCO LOOP parameters
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.target.closest('input, textarea, select')) {
      e.preventDefault();

      if (isVcoActive && window.vcoLoop) {
        // Cycle VCO LOOP parameter tabs
        const params = ['frequency', 'cutoff', 'resonance', 'volume', 'adsr'];
        let activeIdx = params.indexOf(vcoLoop.activeParam);
        
        // Find next valid tab
        let nextIdx = (activeIdx + 1) % params.length;
        if (vcoLoop.continuousMode && params[nextIdx] === 'adsr') {
           nextIdx = (nextIdx + 1) % params.length; // skip ADSR if in CONT mode
        }
        
        vcoLoop.switchParam(params[nextIdx]);
      } else {
        // Cycle Center tabs
        const tabs = document.querySelectorAll('.center-tab');
        let activeIdx = 0;
        tabs.forEach((t, i) => { if (t.classList.contains('active')) activeIdx = i; });
        const nextIdx = (activeIdx + 1) % tabs.length;
        onCenterTabSwitch(tabs[nextIdx].dataset.tab);
      }
    }
  });

  // Initialize left panel state based on initial center tab
  const initialCenterTab = document.querySelector('.center-tab.active');
  if (initialCenterTab) {
    onCenterTabSwitch(initialCenterTab.dataset.tab);
  }

  // First click / touch to init audio context
  const initAudio = async () => {
    await audioEngine.init();
    audioEngine.resume();
    // Initialize effects audio nodes after audio context is ready
    if (window.effectsEngine) {
      effectsEngine.initAudioNodes();
    }
    document.removeEventListener('click', initAudio);
    document.removeEventListener('touchstart', initAudio);
    console.log('Audio context started');
  };

  document.addEventListener('click', initAudio, { once: true });
  document.addEventListener('touchstart', initAudio, { once: true });

  console.log('DLOSy20 ready - click or tap to enable audio');
});
