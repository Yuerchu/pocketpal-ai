import React from 'react';
import {TouchableOpacity, View} from 'react-native';

import {observer} from 'mobx-react';
import {Icon, Text} from 'react-native-paper';
import Clipboard from '@react-native-clipboard/clipboard';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';

import {CopyIcon} from '../../assets/icons';
import {useTheme} from '../../hooks';

import {styles} from './styles';

import {chatSessionStore} from '../../store';
import {derivedText} from '../../utils/chat';
import {MessageType} from '../../utils/types';

const hapticOptions = {
  enableVibrateFallback: true,
  ignoreAndroidSystemSettings: false,
};

interface AssistantTurnFooterProps {
  message: MessageType.Any;
}

export const AssistantTurnFooter: React.FC<AssistantTurnFooterProps> = observer(
  ({message}) => {
    const theme = useTheme();
    const {copyable, timings, interrupted, truncationLikely, rating} =
      message.metadata || {};

    if (!timings && !copyable && !interrupted) {
      return null;
    }

    const componentStyles = styles({theme});

    const timingParts: string[] = [];
    if (timings?.predicted_per_token_ms != null) {
      timingParts.push(
        `${timings.predicted_per_token_ms.toFixed()}ms/token`,
      );
    }
    if (timings?.predicted_per_second != null) {
      timingParts.push(
        `${timings.predicted_per_second.toFixed(2)} tokens/sec`,
      );
    }
    if (timings?.time_to_first_token_ms != null) {
      timingParts.push(`${timings.time_to_first_token_ms}ms TTFT`);
    }
    const fullTimingsString = timingParts.join(', ');

    const copyToClipboard = () => {
      if (message.type !== 'text' && message.type !== 'assistant_turn') {
        return;
      }
      ReactNativeHapticFeedback.trigger('impactLight', hapticOptions);
      Clipboard.setString(derivedText(message).trim());
    };

    const handleRate = (value: 'good' | 'bad') => {
      const sessionId = chatSessionStore.activeSessionId;
      if (!sessionId) {
        return;
      }
      ReactNativeHapticFeedback.trigger('impactLight', hapticOptions);
      const newRating = rating === value ? undefined : value;
      chatSessionStore.updateMessage(message.id, sessionId, {
        metadata: {rating: newRating},
      });
    };

    return (
      <View style={componentStyles.container} testID="assistant-turn-footer">
        {copyable && (
          <>
            <TouchableOpacity onPress={copyToClipboard} testID="footer-copy">
              <CopyIcon
                stroke={theme.colors.textSecondary}
                width={16}
                height={16}
              />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleRate('good')}
              style={componentStyles.ratingButton}
              testID="footer-rate-good">
              <Icon
                source={
                  rating === 'good' ? 'thumb-up' : 'thumb-up-outline'
                }
                size={14}
                color={
                  rating === 'good'
                    ? theme.colors.primary
                    : theme.colors.textSecondary
                }
              />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleRate('bad')}
              style={componentStyles.ratingButton}
              testID="footer-rate-bad">
              <Icon
                source={
                  rating === 'bad' ? 'thumb-down' : 'thumb-down-outline'
                }
                size={14}
                color={
                  rating === 'bad'
                    ? theme.colors.error
                    : theme.colors.textSecondary
                }
              />
            </TouchableOpacity>
          </>
        )}
        {timings && fullTimingsString ? (
          <Text style={componentStyles.timing} testID="footer-timing">
            {fullTimingsString}
          </Text>
        ) : null}
        {interrupted ? (
          <Text
            style={componentStyles.interruptedStatus}
            testID="footer-interrupted-status">
            {truncationLikely
              ? 'Cut off — likely context full'
              : 'Interrupted'}
          </Text>
        ) : null}
      </View>
    );
  },
);
