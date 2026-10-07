import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { pl } from '@/strings/pl';

type Props = {
  visible: boolean;
  onClose: () => void;
};

/** Bottom-sheet glossary for the abbreviations scattered across the app (FBW, RIR, RPE, DOMS, ACL). */
export function GlossaryModal({ visible, onClose }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      // Draw under the system bars so the sheet pads itself by the inset, like every screen.
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable className="flex-1 bg-black/40" onPress={onClose}>
        <Pressable
          className="mt-auto max-h-[80%] rounded-t-[32px] bg-background px-5 pb-6 pt-3"
          style={{ paddingBottom: 16 + insets.bottom }}
          onPress={(e) => e.stopPropagation()}
        >
          <Text variant="heading" className="mb-3">
            {pl.glossary.title}
          </Text>
          {/* shrink: inside the height-capped sheet the list must not grow to its content, or nothing scrolls. */}
          <ScrollView className="shrink" contentContainerClassName="gap-4 pb-2">
            {pl.glossary.terms.map((item) => (
              <View key={item.term}>
                <Text className="text-base font-semibold">{item.term}</Text>
                <Text variant="muted" className="text-sm">
                  {item.definition}
                </Text>
              </View>
            ))}
          </ScrollView>
          <Pressable onPress={onClose} className="items-center py-3.5">
            <Text className="font-display-semibold text-highlight">{pl.common.close}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
