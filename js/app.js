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

  // Initialize VCO Loop Easing
  if (window.vcoEase) {
    vcoEase.init();
  }

  // Initialize Panel Layout (drag-to-resize / drag-to-reorder)
  if (window.panelLayout) {
    panelLayout.init();
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

    // Redraw Easing canvas after tab becomes visible (resize sync)
    if (window.vcoEase && target === 'ease') {
      requestAnimationFrame(() => {
        vcoEase.syncCanvasSize();
        vcoEase.draw();
      });
    }
  }

  document.querySelectorAll('.center-tab').forEach(tab => {
    tab.addEventListener('click', () => onCenterTabSwitch(tab.dataset.tab));
  });

  // ===== Track Active Panel (Center vs VCO Loop vs Drawing Mode) =====
  let isVcoActive = false;
  let isDrawingActive = false;
  document.addEventListener('pointerdown', (e) => {
    if (e.target.closest('#vco-loop-panel')) {
      isVcoActive = true;
      isDrawingActive = false;
    } else if (e.target.closest('#drawing-panel')) {
      isDrawingActive = true;
      isVcoActive = false;
    } else if (e.target.closest('#panel-center')) {
      isVcoActive = false;
      isDrawingActive = false;
    }
  });

  // Tab key: cycle Center tabs / VCO LOOP params / Drawing Mode slots
  // 1-8 keys: switch pattern bank if VCO LOOP / Drawing Mode active
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select')) return;

    // Handle 1-8 keys for pattern/slot switching
    if (e.key >= '1' && e.key <= '8') {
      const idx = parseInt(e.key, 10) - 1;
      if (isVcoActive && window.vcoLoop) {
        e.preventDefault();
        vcoLoop.switchPattern(idx);
      } else if (isDrawingActive && window.drawingMode) {
        e.preventDefault();
        drawingMode.switchPattern(idx);
      }
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();

      if (isDrawingActive && window.drawingMode) {
        // Cycle Drawing Mode slots
        const nextSlot = (drawingMode.activeSlot + 1) % drawingMode.visibleSlotCount;
        drawingMode.switchSlot(nextSlot);
      } else if (isVcoActive && window.vcoLoop) {
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
    // Load saved sample rate + latency mode from localStorage
    let savedSr = 48000;
    let savedLatency = 'interactive';
    try {
      const raw = localStorage.getItem('dlosy20_audio_settings');
      if (raw) {
        const saved = JSON.parse(raw);
        const srVal = parseInt(saved.sampleRate, 10);
        if (!isNaN(srVal)) savedSr = srVal || null; // 0 = OS default → null
        if (saved.latencyHint) savedLatency = saved.latencyHint;
      }
    } catch(e) {}

    await audioEngine.init(savedSr, savedLatency);
    audioEngine.resume();
    // Re-apply previously selected output device (a fresh AudioContext
    // always starts on the OS default device until setSinkId runs again)
    if (window.audioSettings) {
      await audioSettings.applySinkId();
    }
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


  // Resume AudioContext when tab becomes visible again (browser may suspend it in background)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && window.audioEngine) {
      audioEngine.resume();
    }
  });

  console.log('DLOSy20 ready - click or tap to enable audio');
});
