import Combine
import Foundation

@MainActor
final class AppState: ObservableObject {
    let projectLocator = ProjectLocator()
    let configuration = ConfigurationStore()
    let processManager = ProcessManager()

    init() {
        configuration.load(from: projectLocator.projectURL)
    }

    func reloadConfiguration() {
        configuration.load(from: projectLocator.projectURL)
    }

    func chooseProjectFolder() {
        projectLocator.chooseProjectFolder()
        reloadConfiguration()
    }
}
