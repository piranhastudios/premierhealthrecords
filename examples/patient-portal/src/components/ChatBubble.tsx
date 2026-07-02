import { Text, View } from 'react-native';

interface ChatBubbleProps {
  text: string;
  mine: boolean;
  time?: string;
}

export function ChatBubble({ text, mine, time }: ChatBubbleProps): JSX.Element {
  return (
    <View className={`my-1 max-w-[80%] ${mine ? 'self-end' : 'self-start'}`}>
      <View className={`px-3.5 py-2.5 rounded-2xl ${mine ? 'bg-phc-orange rounded-br-sm' : 'bg-surface-card rounded-bl-sm'}`}>
        <Text className={mine ? 'text-white text-base' : 'text-ink text-base'}>{text}</Text>
      </View>
      {time ? (
        <Text className={`text-[11px] text-ink-faint mt-0.5 ${mine ? 'text-right' : 'text-left'}`}>{time}</Text>
      ) : null}
    </View>
  );
}
