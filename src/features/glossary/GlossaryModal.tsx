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
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40" onPress={onClose}>
        <Pressable
          className="mt-auto max-h-[80%] rounded-t-2xl bg-background p-4"
          style={{ paddingBottom: 16 + insets.bottom }}
          onPress={(e) => e.stopPropagation()}
        >
          <Text variant="heading" className="mb-3">
            {pl.glossary.title}
          </Text>
          <ScrollView contentContainerClassName="gap-4 pb-2">
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
            <Text className="text-primary">{pl.common.close}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
