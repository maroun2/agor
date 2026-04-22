# VAD Improvement Plan

Research-based plan for improving voice activity detection in the iOS app.
Current implementation: energy-based EMA threshold in `VoiceActivityDetector.swift`.

---

## Current State vs. Industry Practice

| Aspect | Current | Industry standard | Gap |
|---|---|---|---|
| VAD method | Energy-based EMA | ML (Silero, WebRTC) | Large |
| Silence duration | 3.0s | 300–800ms | Intentionally longer for UX |
| Confirmation window | ~80ms (4 frames) | 250ms | Too short → false triggers |
| Frequency filtering | Full spectrum RMS | 300–1500 Hz bandpass | Picking up keyboard/HVAC noise |
| TTS echo cancellation | State-gating only | WebRTC AEC / iOS voice processing | Vulnerable to speaker feedback |
| Noise floor freeze | During speech ✓ | During speech ✓ | OK |
| Hysteresis gap | start=2.75× end=1.6× | ~0.15 probability gap | Reasonable |
| Calibration | 1.3s ✓ | 1–2s ✓ | OK |

---

## Tier 1: Quick Wins (no new deps, ~1–2 hours)

### 1. Confirmation frames: 4 → 12 (~250ms)
**File**: `VoiceActivityDetector.swift`

Industry standard minimum speech duration is 250ms. At 47fps, that's ~12 frames.
Currently 4 frames (~80ms) lets keyboard clicks and short bursts trigger recording.

```swift
private let confirmationFrames: Int = 12  // ~250ms at 47 fps
```

### 3. Widen end-threshold hysteresis
**File**: `VoiceActivityDetector.swift`

Current `endMultiplier = 1.6` at default sensitivity. Research recommends
end threshold ~20–25% below start. Lower to 1.4 for more stable recording.

```swift
private var endMultiplier: Float { 1.8 - sensitivityLevel * 0.6 }  // 1.8 (low) → 1.2 (high)
```

---

## Tier 2: Medium Effort (~half day)

### 4. Band-limited RMS (300–1500 Hz)
**File**: `VoiceActivityDetector.swift`

Currently RMS computed across full spectrum. HVAC, keyboard clicks, low-frequency
rumble inflate the noise floor. Speech energy lives in 300–1500 Hz.
Apply a bandpass filter via `vDSP` before RMS calculation — no new dependencies.

Implementation sketch:
- Design a 4th-order Butterworth bandpass filter (300–1500 Hz) coefficients
- Apply via `vDSP_biquad` or `vDSP_f5x5` to floatChannelData before computing RMS
- Keep existing EMA + adaptive noise floor logic unchanged

### 5. iOS Voice Processing IO (acoustic echo cancellation)
**File**: `VoiceActivityDetector.swift` → `startListening()`

Replace current audio session mode with Voice Processing IO to get iOS's
built-in AEC — removes TTS speaker output from the mic signal before VAD sees it.

```swift
// Current:
try session.setCategory(.playAndRecord, mode: .voiceChat, options: [...])

// Target: enable kAudioUnitSubType_VoiceProcessingIO on the input node
// This requires using AudioUnit directly or AVAudioEngine with voice processing enabled
// iOS 16+: engine.inputNode.isVoiceProcessingEnabled = true
```

Reference: `AVAudioEngine` / `AVAudioInputNode.isVoiceProcessingEnabled` (iOS 16+)

---

## Tier 3: ML VAD — Silero CoreML (biggest quality jump, ~1 day)

### 6. Replace energy threshold with Silero VAD
**File**: New `SileroVADDetector.swift`, replace `processAudioBuffer` logic

Resources:
- Model: https://huggingface.co/FluidInference/silero-vad-coreml (~2MB)
- Library: https://github.com/baochuquan/ios-vad (Swift, SPM-compatible)

Benefits:
- Output: probability 0.0–1.0 instead of binary energy comparison
- <1ms CPU per 32ms frame
- Dramatically lower false trigger rate (handles keyboard, AC, noise)
- Used by ChatGPT, Gemini, all production voice agents

Parameters:
```
activation_threshold:   0.70  (start recording)
deactivation_threshold: 0.50  (stop recording — hysteresis gap = 0.20)
min_speech_duration_ms: 250
min_silence_duration_ms: 800
speech_pad_ms:          300
```

Integration:
1. Add `ios-vad` via SPM or vendor CoreML model directly
2. In `processAudioBuffer`, call Silero inference instead of computing RMS
3. Map probability output to existing `onSpeechStart` / `onSpeechEnd` callbacks
4. Keep the same state machine and `ContinuousVoiceService` interface unchanged

---

## Recommended Order

1. **Tier 1 now** — constant changes only, immediate improvement to UX
2. **Tier 2 item 5 (AEC)** — if TTS→VAD false triggers persist after Tier 1
3. **Tier 2 item 4 (bandpass)** — if background noise is still an issue
4. **Tier 3 (Silero)** — when ready for a major quality leap with a new dependency
