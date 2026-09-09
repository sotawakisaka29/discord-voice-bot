import AppKit
import Foundation

final class SpeechDelegate: NSObject, NSSpeechSynthesizerDelegate {
    var finished = false

    func speechSynthesizer(_ sender: NSSpeechSynthesizer, didFinishSpeaking finishedSpeaking: Bool) {
        finished = true
    }
}

guard CommandLine.arguments.count == 4 else {
    fatalError("Usage: macos-tts <voice-id> <text> <output-path>")
}

guard let synthesizer = NSSpeechSynthesizer(
    voice: NSSpeechSynthesizer.VoiceName(rawValue: CommandLine.arguments[1])
) else {
    fatalError("音声を初期化できませんでした。")
}

let delegate = SpeechDelegate()
synthesizer.delegate = delegate
let outputURL = URL(fileURLWithPath: CommandLine.arguments[3])

guard synthesizer.startSpeaking(CommandLine.arguments[2], to: outputURL) else {
    fatalError("音声合成を開始できませんでした。")
}

while !delegate.finished {
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.1))
}
