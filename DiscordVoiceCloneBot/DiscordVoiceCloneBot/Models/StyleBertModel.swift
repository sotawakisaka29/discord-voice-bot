import Foundation

struct StyleBertModel: Identifiable, Equatable {
    let id: String
    let modelDirectory: String
    let modelFile: String
}

struct StyleBertModelCatalog: Decodable {
    let defaultModelId: String
    let models: [String: StyleBertModelDefinition]
}

struct StyleBertModelDefinition: Decodable {
    let modelDir: String
    let modelFile: String
}
