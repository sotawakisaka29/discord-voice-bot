import Foundation

struct ComparisonPrompt: Identifiable, Hashable {
    let id: String
    let title: String
    let text: String

    static let presets: [ComparisonPrompt] = [
        ComparisonPrompt(
            id: "short",
            title: "短文",
            text: "おはよう、今日はいい天気だね。"
        ),
        ComparisonPrompt(
            id: "question",
            title: "疑問文",
            text: "明日の予定はもう決まってる？"
        ),
        ComparisonPrompt(
            id: "long",
            title: "長文",
            text: "週末は少し早起きをして、近くの公園まで散歩に行こうと思っています。"
        ),
        ComparisonPrompt(
            id: "numbers",
            title: "数字",
            text: "次の待ち合わせは10月25日の午後3時です。"
        )
    ]
}

struct ModelCheckpoint: Identifiable, Hashable {
    let fileURL: URL
    let step: Int?
    let epoch: Int?

    var id: String { fileURL.path }
    var filename: String { fileURL.lastPathComponent }
    var basename: String { fileURL.deletingPathExtension().lastPathComponent }

    var trainingLabel: String? {
        switch (epoch, step) {
        case let (.some(epoch), .some(step)):
            "(epoch)エポック・(step.formatted())ステップ"
        case let (.none, .some(step)):
            "(step.formatted())ステップ"
        case let (.some(epoch), .none):
            "(epoch)エポック"
        case (.none, .none):
            nil
        }
    }
}
