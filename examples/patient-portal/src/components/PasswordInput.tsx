import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, TextInput, View, type TextInputProps } from 'react-native';
import { colors } from '../theme/tokens';

/**
 * Password field with a show/hide eye toggle. Accepts all TextInput props
 * (value, onChangeText, placeholder, autoComplete, returnKeyType, …) and manages
 * secureTextEntry itself. `pr-12` leaves room so text never runs under the eye.
 */
export function PasswordInput(props: TextInputProps): JSX.Element {
  const [visible, setVisible] = useState(false);
  return (
    <View className="relative justify-center">
      <TextInput
        placeholderTextColor={colors.inkFaint}
        autoCapitalize="none"
        autoCorrect={false}
        {...props}
        secureTextEntry={!visible}
        className="bg-surface-muted rounded-field pl-4 pr-12 h-12 text-ink text-base"
      />
      <Pressable
        onPress={() => setVisible((v) => !v)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={visible ? 'Hide password' : 'Show password'}
        className="absolute right-0 top-0 bottom-0 px-3 items-center justify-center"
      >
        <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={22} color={colors.inkSecondary} />
      </Pressable>
    </View>
  );
}
