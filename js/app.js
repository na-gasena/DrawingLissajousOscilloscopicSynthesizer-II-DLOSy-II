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

  // First click / touch to init audio context
  const initAudio = async () => {
    await audioEngine.init();
    audioEngine.resume();
    document.removeEventListener('click', initAudio);
    document.removeEventListener('touchstart', initAudio);
    console.log('Audio context started');
  };

  document.addEventListener('click', initAudio, { once: true });
  document.addEventListener('touchstart', initAudio, { once: true });

  console.log('DLOSy20 ready - click or tap to enable audio');
});
