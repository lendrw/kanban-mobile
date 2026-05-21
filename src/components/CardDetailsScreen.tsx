import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import CloseIcon from "../icons/CloseIcon";
import type { Task } from "../types";

interface CardDetailsScreenProps {
  task: Task;
  onClose: () => void;
  onTitleChange: (title: string) => void;
  onDescriptionChange: (description: string) => void;
}

function CardDetailsScreen({
  task,
  onClose,
  onTitleChange,
  onDescriptionChange,
}: CardDetailsScreenProps) {
  const { height } = useWindowDimensions();
  const [slideProgress] = useState(() => new Animated.Value(1));
  const isClosingRef = useRef(false);
  const translateY = slideProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, height],
  });

  useEffect(() => {
    slideProgress.setValue(1);
    Animated.timing(slideProgress, {
      toValue: 0,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [slideProgress]);

  const handleClose = useCallback(() => {
    if (isClosingRef.current) return;

    isClosingRef.current = true;
    Animated.timing(slideProgress, {
      toValue: 1,
      duration: 180,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        onClose();
        return;
      }

      isClosingRef.current = false;
    });
  }, [onClose, slideProgress]);

  return (
    <Animated.View
      style={[
        styles.screen,
        {
          transform: [{ translateY }],
        },
      ]}
    >
      <View style={styles.header}>
        <TouchableOpacity
          activeOpacity={0.7}
          accessibilityLabel="Close card details"
          accessibilityRole="button"
          onPress={handleClose}
          style={styles.closeButton}
        >
          <CloseIcon />
        </TouchableOpacity>
        <TextInput
          value={task.content}
          multiline
          placeholder="Card title"
          placeholderTextColor="#8b949e"
          onChangeText={onTitleChange}
          style={styles.titleInput}
          selectionColor="#f43f5e"
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.sectionTitle}>Description</Text>
        <TextInput
          value={task.description ?? ""}
          multiline
          placeholder="Add a more detailed description..."
          placeholderTextColor="#8b949e"
          onChangeText={onDescriptionChange}
          style={styles.descriptionInput}
          textAlignVertical="top"
          selectionColor="#f43f5e"
        />
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#000000",
  },
  header: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#161c22",
    backgroundColor: "#0d1117",
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 4,
  },
  titleInput: {
    flex: 1,
    minHeight: 44,
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "700",
    paddingHorizontal: 0,
    paddingVertical: 8,
  },
  content: {
    padding: 16,
    gap: 10,
  },
  sectionTitle: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },
  descriptionInput: {
    minHeight: 220,
    color: "#ffffff",
    fontSize: 15,
    lineHeight: 22,
    padding: 12,
    borderWidth: 1,
    borderColor: "#30363d",
    borderRadius: 8,
    backgroundColor: "#0d1117",
  },
});

export default CardDetailsScreen;
