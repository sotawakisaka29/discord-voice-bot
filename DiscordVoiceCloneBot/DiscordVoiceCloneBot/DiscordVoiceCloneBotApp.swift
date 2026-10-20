//
//  DiscordVoiceCloneBotApp.swift
//  DiscordVoiceCloneBot
//
//  Created by 脇坂颯大 on 01/10/2026.
//

import AppKit
import SwiftUI

@main
struct DiscordVoiceCloneBotApp: App {
    @StateObject private var appState = AppState()

    init() {
        guard let iconURL = Bundle.main.url(forResource: "AppIcon", withExtension: "icns"),
              let icon = NSImage(contentsOf: iconURL) else { return }
        NSApplication.shared.applicationIconImage = icon
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(appState)
                .environmentObject(appState.projectLocator)
                .environmentObject(appState.configuration)
                .environmentObject(appState.processManager)
                .frame(minWidth: 960, minHeight: 640)
                .onReceive(NotificationCenter.default.publisher(for: NSApplication.willTerminateNotification)) { _ in
                    appState.processManager.stopAll()
                }
                .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
                    appState.reloadConfiguration()
                    appState.processManager.refreshServiceAvailability(in: appState.projectLocator.projectURL)
                }
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1120, height: 760)

        Settings {
            SettingsView()
                .environmentObject(appState)
                .environmentObject(appState.projectLocator)
                .environmentObject(appState.configuration)
                .environmentObject(appState.processManager)
                .frame(width: 640, height: 480)
        }
    }
}
