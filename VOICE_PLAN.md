# Voice Mode Implementation Plan - WhisperKit Continuous Listening

## Core Concept: Hands-Free Voice Conversation

**Primary Mode**: Full voice I/O - speak to agent, agent speaks back
- User speaks → VAD detects → transcribes → sends
- Agent works → **status read aloud**: "Thinking", "Reading file", "Writing code"
- Agent finishes → **final message read aloud** to user
- User speaks next prompt → cycle repeats

**No screen interaction needed**:
- User never needs to look at screen
- Agent status updates spoken in real-time
- Final response spoken when complete
- True hands-free coding conversation

**Toggle**: One mic button enables/disables full voice mode

---

## Architecture: Continuous Listening State Machine

```
┌─────────────────────────────────────────┐
│  Session State: idle/promptable         │
│  ↓                                      │
│  Voice Mode: LISTENING (always on)     │
│  ↓                                      │
│  VAD detects speech                    │
│  ↓                                      │
│  State: RECORDING                       │
│  ↓                                      │
│  VAD detects silence (1.5s)            │
│  ↓                                      │
│  State: TRANSCRIBING                    │
│  ↓                                      │
│  WhisperKit processes audio             │
│  ↓                                      │
│  State: SENDING (auto-send)            │
│  ↓                                      │
│  Back to LISTENING                      │
└─────────────────────────────────────────┘
```

### States

| State | Microphone | Visual | What's Happening |
|-------|-----------|--------|------------------|
| **LISTENING** | Active | Subtle pulse | VAD monitoring for speech (session idle) |
| **RECORDING** | Recording | Animated waveform | User speaking, capturing audio |
| **TRANSCRIBING** | Off | Spinner + waveform | WhisperKit processing |
| **SENDING** | Off | Upload indicator | Sending to agent |
| **PAUSED** | Off | "Agent thinking..." | Agent working - no listening |

**Key Rule**: Only listen when `session.status == 'idle'`. When agent is working, **pause listening** and show status.

---

## Implementation Plan

### Phase 1: Core Voice Pipeline (3-4 days)

#### 1.1 WhisperKit Integration (Speech-to-Text)
```swift
// Add to Package.swift
.package(url: "https://github.com/argmaxinc/WhisperKit.git", from: "0.9.0")
```

**Files to create**:
- `Services/TranscriptionService.swift` - WhisperKit wrapper
  - Initialize with `base-en` model (lazy load)
  - Handle model download with progress
  - Transcribe audio file → text
  - Cache instance globally

#### 1.1b Text-to-Speech Integration
**Option A: iOS Native AVSpeechSynthesizer** (Recommended for MVP)
```swift
import AVFoundation

class TextToSpeechService {
    private let synthesizer = AVSpeechSynthesizer()

    func speak(_ text: String, rate: Float = 0.5) {
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
        utterance.rate = rate
        synthesizer.speak(utterance)
    }

    func stop() {
        synthesizer.stopSpeaking(at: .immediate)
    }
}
```

**Pros**: No dependencies, instant, works offline, 0 MB added
**Cons**: Robotic voice quality

**Option B: WhisperKit's TTSKit** (Future upgrade)
- Natural neural voices
- Requires iOS 18+
- ~1 GB download for 0.6B model
- Better quality but heavier

**Recommendation**: Start with AVSpeechSynthesizer, add TTSKit as optional upgrade

**Files to create**:
- `Services/TextToSpeechService.swift` - TTS wrapper
  - Speak status updates (short, fast rate)
  - Speak final messages (normal rate, summarize if > 500 chars)
  - **Smart queue**: Cancel old status, speak latest only (no backlog)
  - Interrupt handling when user speaks
  - Rate/voice configuration

#### 1.2 Voice Activity Detection Service
**Files to create**:
- `Services/VoiceActivityDetector.swift` - Real-time VAD
  - Use AVAudioEngine for low-latency audio tap
  - Analyze audio buffer RMS/power levels
  - Detect speech start (threshold crossing)
  - Detect speech end (1.5s silence)
  - Configurable sensitivity

#### 1.3 Continuous Voice Service
**Files to create**:
- `Services/ContinuousVoiceService.swift` - Main coordinator

```swift
@Observable
final class ContinuousVoiceService {
    enum State {
        case disabled
        case listening      // VAD active, waiting for speech
        case recording      // User speaking, capturing
        case transcribing   // Processing with Whisper
        case sending        // Sending to agent
        case speaking       // TTS speaking to user
    }

    var state: State = .disabled
    var currentAudioLevel: Float = 0.0
    var transcriptionProgress: String = ""

    private let vad: VoiceActivityDetector
    private let transcription: TranscriptionService
    private let tts: TextToSpeechService
    private var audioRecorder: AVAudioRecorder?

    // Start continuous listening
    func startListening()

    // Stop continuous listening
    func stopListening()

    // VAD callback: speech detected
    func onSpeechStart()

    // VAD callback: silence detected
    func onSpeechEnd()

    // Handle transcription result
    func handleTranscription(_ text: String)

    // Speak agent status update
    func speakStatus(_ status: String)

    // Speak agent's final message
    func speakMessage(_ text: String)
}
```

#### 1.4 Permissions
Add to `Info.plist`:
```xml
<key>NSMicrophoneUsageDescription</key>
<string>Agor uses your microphone for hands-free voice conversations with AI agents</string>

<key>NSSpeechRecognitionUsageDescription</key>
<string>Agor transcribes your speech locally on-device for voice prompts</string>

<key>UIBackgroundModes</key>
<array>
    <string>audio</string>
</array>
```

---

### Phase 2: UI Integration (2-3 days)

#### 2.1 Voice Status Indicator
**Files to create**:
- `Views/Chat/VoiceStatusBar.swift` - Always-visible status

```
┌────────────────────────────────────┐
│ 🎤 Listening...          [••••·]  │  ← LISTENING (pulse animation)
├────────────────────────────────────┤
│ 🔴 Recording...          [████▌]  │  ← RECORDING (waveform)
├────────────────────────────────────┤
│ ⚙️ Transcribing...       [spinner] │  ← TRANSCRIBING
└────────────────────────────────────┘
```

Position: Top of `ChatView`, below navigation bar

#### 2.2 Modify ChatViewModel
Add voice integration:
```swift
// ChatViewModel.swift additions
var voiceService: ContinuousVoiceService?
var voiceModeEnabled: Bool = false {
    didSet {
        if voiceModeEnabled {
            enableVoiceMode()
        } else {
            disableVoiceMode()
        }
    }
}

func enableVoiceMode() {
    guard voiceService == nil else { return }

    voiceService = ContinuousVoiceService(
        onTranscription: { [weak self] text in
            self?.handleVoiceInput(text)
        }
    )
    voiceService?.startListening()
    voiceModeEnabled = true
}

func disableVoiceMode() {
    voiceService?.stopListening()
    voiceService = nil
    voiceModeEnabled = false
}

func handleVoiceInput(_ text: String) {
    // Text appears briefly, then auto-sends
    promptText = text
    Task {
        try? await Task.sleep(for: .milliseconds(500)) // Show what was transcribed
        if promptText == text { // User didn't edit
            sendPrompt()
        }
    }
}

// Start/stop listening based on session state (only when voice mode enabled)
func updateVoiceListening() {
    guard let voice = voiceService else { return }

    // Only listen when session is truly idle (not running/awaiting)
    if currentSession?.status == .idle && isSessionPromptable {
        voice.startListening()
    } else {
        voice.stopListening()
    }
}

// Extract short status from agent activity
var agentStatusText: String {
    guard let session = currentSession else { return "" }

    switch session.status {
    case .idle: return "Ready"
    case .running: return extractCurrentToolStatus() // From streaming messages
    case .awaitingPermission: return "Needs permission"
    case .awaitingInput: return "Needs input"
    default: return session.status.rawValue.capitalized
    }
}

// Extract tool name from latest streaming message
private func extractCurrentToolStatus() -> String {
    // Look at activeStreams or latest message for tool_use blocks
    // Return: "Reading file", "Writing code", "Running command", etc.
    // Default: "Thinking"
    return "Thinking"
}

// Speak status update (called when session status changes)
func speakStatusUpdate() {
    guard voiceModeEnabled else { return }
    let status = agentStatusText
    voiceService?.speakStatus(status)
}

// Speak final message (called when agent finishes)
func speakFinalMessage() {
    guard voiceModeEnabled, let lastMessage = messages.last else { return }

    // Extract text content from assistant message
    let text = extractTextFromMessage(lastMessage)

    // Summarize if too long
    let spokenText = text.count > 500 ? summarize(text) : text

    voiceService?.speakMessage(spokenText)
}

private func extractTextFromMessage(_ message: Message) -> String {
    // Parse message.content (text blocks only)
    // Skip tool_use, tool_result blocks
    // Concatenate text blocks
    return ""
}

private func summarize(_ text: String) -> String {
    // Take first 2-3 sentences
    // Or first 400 chars + "..."
    return String(text.prefix(400)) + "..."
}
```

#### 2.3 Voice Toggle Button
**Primary UI**: Large button in `PromptInputBar` (replaces text field when active)

**Option A: Inline Toggle** (Recommended)
```swift
// PromptInputBar.swift
HStack {
    if voiceMode {
        // Voice mode active - show voice UI
        VoiceStatusIndicator(state: voiceService.state)
            .frame(maxWidth: .infinity)

        Button {
            disableVoiceMode()
        } label: {
            Image(systemName: "mic.slash.fill")
                .font(.system(size: 20))
        }
    } else {
        // Text mode - normal UI
        attachmentMenu
        textField
        sendButton

        // Voice mode toggle
        Button {
            enableVoiceMode()
        } label: {
            Image(systemName: "mic.fill")
                .font(.system(size: 20))
                .foregroundStyle(.blue)
        }
    }
}
```

**When enabled**:
- Text field hidden
- Shows: `🎤 Listening...` with waveform
- Tap mic button again to disable → returns to text mode

**When disabled**:
- Normal text input shown
- Small mic button available to enable

**Visual**:
```
┌─────────────────────────────────────┐
│ [📎] [Type a prompt...    ] [🎤] ↑ │  ← Voice disabled
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ [🎤 Listening... ▁▂▃▂▁]        [🔇] │  ← Voice enabled
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ [🔴 Recording... ▁▃▆█▆▃▁]      [🔇] │  ← User speaking
└─────────────────────────────────────┘
```

---

### Phase 3: Smart State Transitions (2 days)

#### 3.1 Pause During Agent Activity
Hook into session state changes:

```swift
// In ChatViewModel.setupSocketHandlers()

socketService.onSessionPatched { [weak self] session in
    guard let self, session.sessionId == self.currentSessionId else { return }
    let oldStatus = self.currentSession?.status
    self.currentSession = session

    // Speak status changes in voice mode
    if voiceModeEnabled && oldStatus != session.status {
        switch session.status {
        case .running:
            speakStatusUpdate() // "Thinking"
        case .idle:
            // Check if there's a new final message
            if hasNewMessage(since: oldStatus) {
                speakFinalMessage() // Read final response
            } else if oldStatus == .running {
                // Went from running → idle without new message (aborted/cancelled)
                voiceService?.speakStatus("Stopped")
            }
            // Then resume listening (handled by updateVoiceListening)
        case .awaitingPermission:
            voiceService?.speakStatus("I need permission")
        case .awaitingInput:
            voiceService?.speakStatus("I need input")
        default:
            break
        }
    }

    // Update voice listening based on new state
    self.updateVoiceListening()
}

// Check if a new message arrived (to distinguish normal completion from abort)
private func hasNewMessage(since oldStatus: SessionStatus?) -> Bool {
    // Compare message count or timestamp of last message
    // Return true if new assistant message appeared
    // Return false if agent just stopped without output
    return messages.last?.role == .assistant &&
           messages.last?.createdAt > (currentSession?.updatedAt ?? Date.distantPast)
}

// Speak status as streaming events arrive (event-driven, not timer-based)
socketService.onStreamingChunk { [weak self] event in
    guard let self, voiceModeEnabled else { return }

    // Extract tool name from streaming event
    if let toolName = extractToolFromEvent(event) {
        // Speak immediately (TTS service handles canceling previous status)
        voiceService?.speakStatus(toolName)
    }
}

private func extractToolFromEvent(_ event: StreamingEvent) -> String? {
    // Parse event for tool_use blocks
    // Examples:
    //   tool: "Read" → speak: "Reading file"
    //   tool: "Edit" → speak: "Writing code"
    //   tool: "Bash" → speak: "Running command"
    //   thinking block → speak: "Thinking"
    return nil
}
```

#### 3.2 Voice Feedback by Agent State
Agent status **spoken aloud** + visual indicator:

| Agent State | Voice State | Visual UI | Spoken Aloud |
|------------|-------------|-----------|--------------|
| `idle` | LISTENING | "🎤 Listening..." | (silence) |
| `running` | SPEAKING | "🔊 Agent working..." | "Thinking" |
| `awaitingPermission` | PAUSED | "⏸️ Needs permission..." | "I need permission" |
| `awaitingInput` | PAUSED | "⏸️ Needs input..." | "I need input" |

**Status messages spoken as events arrive**:
- Listen to WebSocket streaming events (tool_use, thinking, etc.)
- Speak status when event streams in, not on timer
- Extract from streaming blocks: "Reading file X.swift", "Running npm install", "Writing code"
- Keep spoken status short: 2-4 words max
- User hears what agent is doing in real-time

**When agent finishes**:
- Extract final assistant message (text blocks only, skip tool blocks)
- Speak message aloud (summarize if > 500 chars)
- If no new message but status changed running → idle: speak "Stopped" or "Aborted"
- Resume listening when speech completes

#### 3.3 Speech Queue Management with Skip-to-Latest
Handle overlapping speech scenarios:

**Status Updates** (skip old, speak latest):
```swift
class TextToSpeechService {
    private var currentStatusUtterance: AVSpeechUtterance?
    private var pendingStatus: String?

    func speakStatus(_ text: String) {
        // If already speaking status, cancel it and speak new one
        if synthesizer.isSpeaking {
            pendingStatus = nil  // Drop any pending
            synthesizer.stopSpeaking(at: .immediate)
        }

        let utterance = AVSpeechUtterance(string: text)
        utterance.rate = 0.6  // Faster for status
        currentStatusUtterance = utterance
        synthesizer.speak(utterance)
    }
}
```

**Rules**:
- If TTS speaking status and new status arrives → **cancel current, speak new** (skip old)
- If 2+ status updates queued → **drop all, speak only latest**
- If user starts talking while TTS speaking → **interrupt TTS immediately**, start recording
- Final message has priority over status (status cancelled if final message ready)
- Listening resumes only after all speech finishes

---

### Phase 4: Voice Settings & Optimization (2 days)

#### 4.1 Settings UI
**Files to create**:
- `Views/Settings/VoiceSettingsView.swift`

```
Voice Settings
├─ Speech Recognition (Input)
│  ├─ Model Quality
│  │  ├─ Base (75 MB, faster)        [Selected]
│  │  └─ Small (250 MB, better)      [ ]
│  ├─ Sensitivity
│  │  └─ [Slider: Low ←●→ High]
│  ├─ Silence Timeout
│  │  └─ [1.0s] [1.5s●] [2.0s] [2.5s]
│  └─ Language
│     └─ [English] [Spanish] [French] [Auto-detect]
│
├─ Speech Synthesis (Output)
│  ├─ Voice Type
│  │  ├─ iOS Native (0 MB, basic)    [Selected]
│  │  └─ TTSKit (1 GB, natural)      [ ]
│  ├─ Speaking Rate
│  │  ├─ Status Updates: [0.5 ←●→ 0.8]
│  │  └─ Final Messages: [0.3 ←●→ 0.6]
│  ├─ Read Status Updates            [Toggle: ON]
│  └─ Read Final Messages            [Toggle: ON]
│
├─ Auto-Send Transcription           [Toggle: ON]
│  └─ Delay before sending           [0.5s●]
│
└─ Storage
   └─ Delete Downloaded Models       [Button]
```

**Note**: Voice mode enabled/disabled via mic button in chat, not in settings

#### 4.2 Performance Optimizations
- **Lazy load WhisperKit**: Don't initialize until voice mode enabled
- **Model caching**: Keep Whisper instance alive across sessions
- **Audio buffering**: Circular buffer for VAD (prevent memory growth)
- **Background mode**: Maintain audio session when app backgrounded
- **Battery optimization**: Lower VAD sample rate when on battery

#### 4.3 Privacy Indicators
iOS 18 requirement - show when mic is active:
- Recording indicator in status bar (system)
- Custom in-app indicator (our voice status bar)
- Settings to disable/enable anytime

---

## Voice Activity Detection Algorithm

```swift
class VoiceActivityDetector {
    private let energyThreshold: Float = 0.02  // Speech start
    private let silenceThreshold: Float = 0.01 // Speech end
    private let silenceDuration: TimeInterval = 1.5 // Seconds

    func analyzeAudioBuffer(_ buffer: AVAudioPCMBuffer) {
        let rms = calculateRMS(buffer)

        if state == .listening && rms > energyThreshold {
            // Speech detected!
            speechStartTime = Date()
            state = .speaking
            onSpeechStart?()
        }

        if state == .speaking && rms < silenceThreshold {
            let silenceDuration = Date().timeIntervalSince(lastSoundTime)
            if silenceDuration > 1.5 {
                // Silence detected - end of speech
                state = .listening
                onSpeechEnd?()
            }
        }

        if rms > silenceThreshold {
            lastSoundTime = Date()
        }
    }

    private func calculateRMS(_ buffer: AVAudioPCMBuffer) -> Float {
        guard let floatData = buffer.floatChannelData?[0] else { return 0 }
        let frameLength = Int(buffer.frameLength)
        var sum: Float = 0
        for i in 0..<frameLength {
            sum += floatData[i] * floatData[i]
        }
        return sqrt(sum / Float(frameLength))
    }
}
```

---

## Model Download Strategy

**First launch with voice enabled**:
1. Show permission prompt for microphone
2. User grants → show model download sheet
3. Download `base-en` (~75 MB) with progress bar
4. Cache in `Documents/whisper-models/`
5. Initialize WhisperKit
6. Start listening

**Subsequent launches**:
- Model already cached → instant start
- No download needed

---

## File Structure

```
apps/agor-ios/AgorApp/
├── Services/
│   ├── VoiceActivityDetector.swift          # VAD engine
│   ├── TranscriptionService.swift           # WhisperKit (STT)
│   ├── TextToSpeechService.swift            # TTS (AVSpeechSynthesizer)
│   ├── ContinuousVoiceService.swift         # Main coordinator
│   └── VoiceSettingsManager.swift           # Persist settings
├── ViewModels/
│   └── ChatViewModel.swift                  # [MODIFY] Add voice I/O hooks
├── Views/
│   ├── Chat/
│   │   ├── ChatView.swift                   # [MODIFY] Add voice toggle
│   │   ├── VoiceStatusBar.swift             # Status indicator
│   │   └── VoiceWaveformView.swift          # Animated waveform
│   └── Settings/
│       ├── SettingsView.swift               # [MODIFY] Add voice section
│       └── VoiceSettingsView.swift          # Voice I/O config
└── Models/
    └── VoiceSettings.swift                  # Settings model
```

---

## Implementation Sequence

### Week 1: Input Pipeline (STT)
- [ ] Add WhisperKit dependency
- [ ] Create `TranscriptionService` (model download + transcribe)
- [ ] Create `VoiceActivityDetector` (basic VAD)
- [ ] Create `ContinuousVoiceService` (state machine - STT only)
- [ ] Add microphone permissions
- [ ] Test pipeline: speak → detect → record → transcribe → send

### Week 2: Output Pipeline (TTS) + Integration
- [ ] Create `TextToSpeechService` (AVSpeechSynthesizer)
- [ ] Add TTS to `ContinuousVoiceService`
- [ ] Integrate into `ChatViewModel`
  - Speak status updates on session state change
  - Speak final message when agent finishes
  - Extract tool names from streaming messages
- [ ] Create `VoiceStatusBar` UI (shows listening/recording/speaking state)
- [ ] Add voice toggle button to `PromptInputBar`
- [ ] Test full cycle: speak → agent works (spoken status) → response spoken → listen again

### Week 3: Polish & Settings
- [ ] Create `VoiceSettingsView`
  - Input settings (model, sensitivity, timeout, language)
  - Output settings (voice type, rate, update frequency)
- [ ] Speech queue management (interrupt handling)
- [ ] Message summarization for long responses
- [ ] Throttle status updates (speak every 5s max)
- [ ] Optimize battery usage
- [ ] Handle background/interruptions (calls)
- [ ] Haptic feedback
- [ ] Onboarding flow

---

## UX Flow Example

**User opens session:**
1. Session loads → status: `idle`
2. Normal text input shown with mic button
3. User taps mic button → enables voice mode
4. Text field replaced with: "🎤 Listening..." (subtle pulse)

**User speaks: "Add a login button"**
5. VAD detects speech → "🔴 Recording..." (waveform animates)
6. User stops speaking → 1.5s silence
7. "⚙️ Transcribing..." (spinner)
8. WhisperKit: "Add a login button"
9. Text appears in prompt field briefly (500ms)
10. Auto-send to agent
11. Session status → `running`
12. **TTS speaks: "Thinking"** (visual: "🔊 Agent working...")

**Agent responds with thinking + code:**
13. Thinking blocks stream in → **TTS: "Thinking"**
14. Tool events stream: Read event → **TTS: "Reading file"** (cancels "Thinking")
15. Edit event streams in → **TTS: "Writing code"** (cancels "Reading file")
16. Bash event streams in → **TTS: "Running command"** (cancels "Writing code")
17. If multiple events arrive fast → only latest is spoken (old ones skipped)
18. User hears real-time updates without lag or backlog
19. Voice mode paused (mic off, not listening)

**Agent goes idle:**
20. Session status → `idle`
21. **TTS speaks final message**: "I've added a login button to the home screen with email and password fields. The button is styled in blue and includes basic validation."
22. After TTS finishes → voice mode resumes: "🎤 Listening..." (ready for next prompt)
23. User speaks next prompt → cycle repeats

**Edge case - Agent aborted/cancelled:**
1. Agent is running (status: `running`)
2. User stops session or error occurs
3. Session status → `idle` (no new message)
4. **TTS speaks: "Stopped"** (notifies user agent stopped without output)
5. Voice mode resumes: "🎤 Listening..."

---

## Storage Requirements

| Component | Size |
|-----------|------|
| WhisperKit framework (STT) | ~10 MB |
| base-en STT model | ~75 MB |
| small-en STT model (optional) | ~250 MB |
| **AVSpeechSynthesizer (TTS)** | **0 MB** (built into iOS) |
| TTSKit 0.6B (optional upgrade) | ~1 GB |
| TTSKit 1.7B (optional, macOS only) | ~2.2 GB |
| **Total (base config)** | **~85 MB** |
| **Total (with small STT)** | **~260 MB** |
| **Total (with small STT + TTSKit)** | **~1.26 GB** |

**Recommendation**: Start with **AVSpeechSynthesizer (0 MB)** for TTS
- Good enough for status updates ("Thinking", "Reading file")
- Acceptable for short responses
- Upgrade to TTSKit later if users want natural voice

**Comparison**:
- ChatGPT iOS: ~150 MB
- Claude iOS: ~120 MB
- **Agor with voice (base)**: ~100-115 MB ✓
- **Agor with voice (natural TTS)**: ~1.3 GB

---

## Privacy & Battery Considerations

### Privacy
- All processing on-device (no cloud)
- Microphone only active when voice mode enabled
- Visual indicator always shown when listening
- Easy toggle to disable
- Audio deleted immediately after transcription

### Battery
- VAD uses minimal CPU (~1-2%)
- Whisper transcription: ~3-5s burst per prompt
- Background audio: minimal drain
- Auto-pause when device locked (optional setting)

---

## Testing Checklist

**Input (STT)**:
- [ ] Voice works in quiet environment
- [ ] Voice works with background noise
- [ ] VAD doesn't trigger on keyboard typing
- [ ] VAD doesn't trigger on other people speaking
- [ ] Transcription accuracy >90% for clear speech
- [ ] Auto-send works after transcription

**Output (TTS)**:
- [ ] Status updates spoken when agent starts working
- [ ] Final message spoken when agent finishes normally
- [ ] "Stopped" spoken when agent aborted without output
- [ ] TTS interrupted when user starts speaking
- [ ] Multiple status updates don't overlap (queue managed)
- [ ] Long messages summarized before speaking
- [ ] Speech rate comfortable (not too fast/slow)

**Integration**:
- [ ] Voice mode toggles on/off correctly
- [ ] Listening resumes after TTS finishes
- [ ] Voice pauses during phone calls
- [ ] Voice resumes after app returns from background
- [ ] Settings persist across app restarts

**Performance**:
- [ ] Model download shows progress
- [ ] Model deletion frees up space
- [ ] No memory leaks during extended use
- [ ] Battery drain <5% per hour of listening
- [ ] No audio glitches or stuttering

---

## Future Enhancements (Post-MVP)

- [ ] Wake word detection ("Hey Agor")
- [ ] Speaker diarization (multi-user conversations)
- [ ] Streaming transcription (real-time text as speaking)
- [ ] Voice commands ("Stop", "Undo", "Repeat that")
- [ ] Multi-language auto-detection
- [ ] Offline model updates
- [ ] Voice shortcuts (Siri integration)
- [ ] AirPods Pro spatial audio support

---

## Success Metrics

**Target**: Hands-free voice mode as natural as talking to a human
- User can have entire coding session without touching keyboard
- Transcription accuracy >95% in normal conditions
- Latency: speak → send <3 seconds total
- No false positives from background noise
- Battery drain acceptable (<10% per hour)
