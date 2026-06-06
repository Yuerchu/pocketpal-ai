import {Platform, Alert} from 'react-native';

import {format} from 'date-fns';
import Share from 'react-native-share';
import * as RNFS from '@dr.pogodin/react-native-fs';

import {chatSessionRepository} from '../repositories/ChatSessionRepository';

import {uiStore} from '../store';
import {ensureLegacyStoragePermission} from './androidPermission';
import {assistantId, derivedText} from './chat';
import type {Message} from '../database';

/**
 * Project a WatermelonDB Message into the export DTO. For
 * `assistant_turn` rows the `text` column is empty by design — we
 * route through `derivedText(toMessageObject())` so the export carries
 * the visible joined content. Same DTO shape as before for `text` rows.
 */
const toExportedMessage = (msg: Message) => {
  const inMemory = msg.toMessageObject();
  return {
    id: msg.id,
    author: msg.author,
    text: derivedText(inMemory),
    type: msg.type,
    metadata: msg.metadata ? JSON.parse(msg.metadata) : {},
    createdAt: msg.createdAt,
  };
};
/**
 * Export a single chat session to a JSON file
 * @param sessionId The ID of the session to export
 */
export const exportChatSession = async (sessionId: string): Promise<void> => {
  try {
    // Get the session data
    const sessionData = await chatSessionRepository.getSessionById(sessionId);
    if (!sessionData) {
      throw new Error('Session not found');
    }

    // Format the session data for export
    const {session, messages, completionSettings} = sessionData;

    const exportData = {
      id: session.id,
      title: session.title,
      date: session.date,
      messages: messages.map(toExportedMessage),
      completionSettings: completionSettings
        ? JSON.parse(completionSettings.settings)
        : {},
      activePalId: session.activePalId,
    };

    // Create a filename with the session title and date
    const timestamp = format(new Date(), 'yyyy-MM-dd_HH-mm-ss');
    const sanitizedTitle = session.title
      .replace(/[^a-z0-9]/gi, '_')
      .toLowerCase();
    const filename = `chat_${sanitizedTitle}_${timestamp}.json`;

    // Convert to JSON
    const jsonData = JSON.stringify(exportData, null, 2);

    // Share the file
    await shareJsonData(jsonData, filename);
  } catch (error) {
    console.error('Error exporting chat session:', error);
    throw error;
  }
};

/**
 * Export all chat sessions to a JSON file
 */
export const exportAllChatSessions = async (): Promise<void> => {
  try {
    // Get all sessions
    const sessions = await chatSessionRepository.getAllSessions();

    // Create an array to hold all exported sessions
    const exportData: any[] = [];

    // Process each session
    for (const session of sessions) {
      const sessionData = await chatSessionRepository.getSessionById(
        session.id,
      );
      if (sessionData) {
        const {
          session: sessionInfo,
          messages,
          completionSettings,
        } = sessionData;

        exportData.push({
          id: sessionInfo.id,
          title: sessionInfo.title,
          date: sessionInfo.date,
          messages: messages.map(toExportedMessage),
          completionSettings: completionSettings
            ? JSON.parse(completionSettings.settings)
            : {},
          activePalId: sessionInfo.activePalId,
        });
      }
    }

    // Create a filename with the current date
    const timestamp = format(new Date(), 'yyyy-MM-dd_HH-mm-ss');
    const filename = `all_chat_sessions_${timestamp}.json`;

    // Convert to JSON
    const jsonData = JSON.stringify(exportData, null, 2);

    // Share the file
    await shareJsonData(jsonData, filename);
  } catch (error) {
    console.error('Error exporting all chat sessions:', error);
    throw error;
  }
};

/**
 * Export messages that have been rated (good/bad) as JSONL for DPO/SFT training.
 */
export const exportRatedDataAsJsonl = async (): Promise<void> => {
  try {
    const sessions = await chatSessionRepository.getAllSessions();
    const lines: string[] = [];

    for (const session of sessions) {
      const sessionData = await chatSessionRepository.getSessionById(
        session.id,
      );
      if (!sessionData) {
        continue;
      }

      const {messages} = sessionData;
      // messages are sorted by position DESC — reverse to chronological
      const chronological = [...messages].reverse();

      for (let i = 0; i < chronological.length; i++) {
        const msg = chronological[i];
        const inMemory = msg.toMessageObject();
        const msgRating = inMemory.metadata?.rating;
        if (!msgRating) {
          continue;
        }
        // Only assistant messages can be rated
        if (inMemory.author.id !== assistantId) {
          continue;
        }

        const history: Array<{role: string; content: string}> = [];
        for (let j = 0; j <= i; j++) {
          const histMsg = chronological[j].toMessageObject();
          const role =
            histMsg.author.id === assistantId ? 'assistant' : 'user';
          const content = derivedText(histMsg).trim();
          if (!content) {
            continue;
          }
          history.push({role, content});
        }

        // Ensure history starts with user and ends with assistant
        while (history.length > 0 && history[0].role !== 'user') {
          history.shift();
        }
        if (
          history.length === 0 ||
          history[history.length - 1].role !== 'assistant'
        ) {
          continue;
        }

        lines.push(
          JSON.stringify({
            messages: history,
            rating: msgRating,
            timestamp: inMemory.createdAt || 0,
          }),
        );
      }
    }

    if (lines.length === 0) {
      Alert.alert('No Rated Data', 'No messages have been rated yet.');
      return;
    }

    const jsonlData = lines.join('\n') + '\n';
    const timestamp = format(new Date(), 'yyyy-MM-dd_HH-mm-ss');
    const filename = `rated_data_${timestamp}.jsonl`;

    await shareJsonData(jsonlData, filename);
  } catch (error) {
    console.error('Error exporting rated data:', error);
    Alert.alert('Export Error', 'Failed to export rated data.');
  }
};

/**
 * Export legacy chat sessions from JSON file
 */
export const exportLegacyChatSessions = async (): Promise<void> => {
  try {
    // Check if the legacy file exists
    const legacyFilePath = `${RNFS.DocumentDirectoryPath}/session-metadata.json`;
    const exists = await RNFS.exists(legacyFilePath);

    if (!exists) {
      throw new Error('Legacy chat sessions file not found');
    }

    // Read the legacy file
    const legacyData = await RNFS.readFile(legacyFilePath);

    // Create a filename with the current date
    const timestamp = format(new Date(), 'yyyy-MM-dd_HH-mm-ss');
    const filename = `legacy_chat_sessions_${timestamp}.json`;

    // Share the file
    await shareJsonData(legacyData, filename);
  } catch (error) {
    console.error('Error exporting legacy chat sessions:', error);
    throw error;
  }
};

/**
 * Helper function to share JSON data as a file
 */
const shareJsonData = async (
  jsonData: string,
  filename: string,
): Promise<void> => {
  const currentL10n = uiStore.l10n;
  try {
    // Create a temporary file
    const tempFilePath = `${RNFS.CachesDirectoryPath}/${filename}`;
    await RNFS.writeFile(tempFilePath, jsonData, 'utf8');

    // Share the file
    if (Platform.OS === 'ios') {
      // On iOS, use react-native-share
      await Share.open({
        url: `file://${tempFilePath}`,
        title: `Share ${filename}`,
        type: 'application/json',
        failOnCancel: false,
      });
    } else if (Platform.OS === 'android' && Platform.Version === 29) {
      // Special handling for Android 10 (API 29)
      // Use direct sharing from temp directory instead of saving to Downloads
      try {
        await Share.open({
          url: `file://${tempFilePath}`,
          title: `Share ${filename}`,
          type: 'application/json',
          failOnCancel: false,
        });
        return; // Exit early after sharing
      } catch (error) {
        console.error('Error sharing on Android 10:', error);
        throw error;
      }
    } else {
      // On Android (not API 29), handle with storage permissions
      const permissionGranted = await ensureLegacyStoragePermission();
      if (!permissionGranted) {
        // If permission denied, fall back to direct sharing
        try {
          await Share.open({
            url: `file://${tempFilePath}`,
            title: `Share ${filename}`,
            type: 'application/json',
            failOnCancel: false,
          });
          return; // Exit early after sharing
        } catch (error) {
          console.error('Error sharing after permission denied:', error);
          throw error;
        }
      }

      try {
        // Save to appropriate directory based on platform
        const saveDir = getSaveDirectory();
        const savePath = `${saveDir}/${filename}`;
        await RNFS.copyFile(tempFilePath, savePath);

        // Show success message with the path
        const fileSavedMsg =
          currentL10n.components.exportUtils.fileSavedMessage.replace(
            '{{filename}}',
            filename,
          );

        Alert.alert(
          currentL10n.components.exportUtils.fileSaved,
          fileSavedMsg,
          [
            {
              text: currentL10n.components.exportUtils.share,
              onPress: async () => {
                // Use react-native-share for both platforms
                try {
                  const options = {
                    title: `Share ${filename}`,
                    message: 'PocketPal AI Chat Export',
                    url: `file://${savePath}`,
                    type: 'application/json',
                    failOnCancel: false,
                  };

                  await Share.open(options);
                } catch (error) {
                  const shareError = error as any;
                  console.error('Error sharing file:', shareError);

                  // Fallback to sharing content directly if file sharing fails
                  if (shareError.message !== 'User did not share') {
                    try {
                      await Share.open({
                        title: `Share ${filename}`,
                        message: jsonData,
                      });
                    } catch (err) {
                      const fallbackError = err as any;
                      console.error(
                        'Error with fallback sharing:',
                        fallbackError,
                      );
                      // Ignore cancellation errors
                      if (fallbackError.message !== 'User did not share') {
                        Alert.alert(
                          currentL10n.components.exportUtils.shareError,
                          currentL10n.components.exportUtils.shareErrorMessage,
                          [{text: currentL10n.components.exportUtils.ok}],
                        );
                      }
                    }
                  }
                }
              },
            },
            {text: currentL10n.components.exportUtils.ok},
          ],
        );
      } catch (error) {
        console.error('Error saving to Downloads:', error);

        // Fallback to just sharing the file content
        Alert.alert(
          currentL10n.components.exportUtils.saveOptions,
          currentL10n.components.exportUtils.saveOptionsMessage,
          [
            {
              text: currentL10n.components.exportUtils.share,
              onPress: async () => {
                // For fallback, share the file content directly
                try {
                  await Share.open({
                    title: `Share ${filename}`,
                    message: jsonData,
                  });
                } catch (err) {
                  const shareError = err as any;
                  console.error('Error sharing content:', shareError);
                  // Ignore cancellation errors
                  if (shareError.message !== 'User did not share') {
                    Alert.alert(
                      currentL10n.components.exportUtils.shareError,
                      currentL10n.components.exportUtils
                        .shareContentErrorMessage,
                      [{text: currentL10n.components.exportUtils.ok}],
                    );
                  }
                }
              },
            },
            {text: currentL10n.components.exportUtils.cancel},
          ],
        );
      }
    }
  } catch (error: any) {
    console.error('Error sharing JSON data:', error);

    // Show a more user-friendly error message
    Alert.alert(
      currentL10n.components.exportUtils.exportError,
      currentL10n.components.exportUtils.exportErrorMessage,
      [{text: currentL10n.components.exportUtils.ok}],
    );

    throw error;
  }
};

/**
 * Get the appropriate directory for saving files
 * @returns The path to the directory
 */
const getSaveDirectory = (): string => {
  if (Platform.OS === 'ios') {
    return RNFS.DocumentDirectoryPath;
  } else {
    return RNFS.DownloadDirectoryPath;
  }
};
