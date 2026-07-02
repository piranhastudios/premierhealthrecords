// NativeWind v4 only wires `className` → `style` for React Native's own core
// components (View, Text, Pressable, ScrollView, TextInput, ...). Third-party
// components that merely forward a `style` prop to an inner View must be
// registered explicitly, otherwise their `className` is silently dropped.
//
// That dropped className is exactly why the sign-in `LinearGradient` collapsed
// to content height (its `flex-1` / padding never applied) and why `Screen`'s
// `SafeAreaView` lost its insets + background. Register them once, at app start,
// so `className` works on them everywhere.
import { LinearGradient } from 'expo-linear-gradient';
import { cssInterop } from 'nativewind';
import { SafeAreaView } from 'react-native-safe-area-context';

cssInterop(LinearGradient, { className: 'style' });
cssInterop(SafeAreaView, { className: 'style' });
