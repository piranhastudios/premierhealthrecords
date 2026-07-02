import { Image, Text, View } from 'react-native';

interface AvatarProps {
  initials: string;
  uri?: string;
  size?: number;
  className?: string;
}

export function Avatar({ initials, uri, size = 44, className = '' }: AvatarProps): JSX.Element {
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        className={className}
      />
    );
  }
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2 }}
      className={`bg-phc-orange/15 items-center justify-center ${className}`}
    >
      <Text className="text-phc-ember font-bold" style={{ fontSize: size * 0.36 }}>
        {initials}
      </Text>
    </View>
  );
}
