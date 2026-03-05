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

  // Initialize Preset Manager (save/load)
  if (window.presetManager) {
    presetManager.init();
  }

  // Center panel tab switching (Sequencer / Drums)
  document.querySelectorAll('.center-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      // Update tab buttons
      document.querySelectorAll('.center-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Switch content
      const target = tab.dataset.tab;
      document.querySelectorAll('.center-tab-content').forEach(c => c.classList.remove('active'));
      const content = document.getElementById(`center-tab-${target}`);
      if (content) content.classList.add('active');
    });
  });

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
