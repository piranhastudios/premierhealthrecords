import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { cardShadow } from '../../theme/tokens';

interface CardProps {
  children: ReactNode;
  className?: string;
  onPress?: () => void;
}

export function Card({ children, className = '', onPress }: CardProps): JSX.Element {
  const base = `bg-surface-card rounded-card p-4 ${className}`;
  if (onPress) {
    return (
      <Pressable onPress={onPress} className={base} style={cardShadow}>
        {children}
      </Pressable>
    );
  }
  return (
    <View className={base} style={cardShadow}>
      {children}
    </View>
  );
}
