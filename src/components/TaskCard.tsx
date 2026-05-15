import { useMemo, useState } from "react";
import {
  Animated,
  PanResponder,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import TrashIcon from "../icons/TrashIcon";
import type { Id, Task } from "../types";

interface TaskCardProps {
  task: Task;
  deleteTask: (id: Task["id"]) => void;
  updateTask: (id: Task["id"], content: Task["content"]) => void;
  moveTask: (id: Id, deltaX: number, deltaY: number) => void;
}

function TaskCard({ task, deleteTask, updateTask, moveTask }: TaskCardProps) {
  const [editMode, setEditMode] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [drag] = useState(() => new Animated.ValueXY());

  const taskPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          !editMode && Math.abs(gesture.dx) + Math.abs(gesture.dy) > 4,
        onPanResponderGrant: () => {
          setIsDragging(true);
          drag.setOffset({ x: 0, y: 0 });
          drag.setValue({ x: 0, y: 0 });
        },
        onPanResponderMove: Animated.event(
          [null, { dx: drag.x, dy: drag.y }],
          { useNativeDriver: false },
        ),
        onPanResponderRelease: (_, gesture) => {
          setIsDragging(false);
          drag.flattenOffset();
          drag.setValue({ x: 0, y: 0 });
          moveTask(task.id, gesture.dx, gesture.dy);
        },
        onPanResponderTerminate: () => {
          setIsDragging(false);
          drag.flattenOffset();
          drag.setValue({ x: 0, y: 0 });
        },
      }),
    [drag, editMode, moveTask, task.id],
  );

  if (editMode) {
    return (
      <View style={styles.card}>
        <TextInput
          value={task.content}
          autoFocus
          multiline
          placeholder="Task content here"
          placeholderTextColor="#8b949e"
          onChangeText={(content) => updateTask(task.id, content)}
          onBlur={() => setEditMode(false)}
          style={styles.input}
          selectionColor="#f43f5e"
        />
      </View>
    );
  }

  return (
    <Animated.View
      style={[
        styles.card,
        isDragging && styles.draggingCard,
        { transform: [{ translateX: drag.x }, { translateY: drag.y }] },
      ]}
      {...taskPanResponder.panHandlers}
    >
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => setEditMode(true)}
        style={styles.contentButton}
      >
        <Text style={styles.content}>{task.content}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => deleteTask(task.id)}
        style={styles.deleteButton}
      >
        <TrashIcon />
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 100,
    height: 100,
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    borderRadius: 12,
    backgroundColor: "#0d1117",
  },
  draggingCard: {
    opacity: 0.5,
    borderWidth: 2,
    borderColor: "#f43f5e",
    zIndex: 20,
  },
  contentButton: {
    flex: 1,
    minHeight: 80,
    justifyContent: "center",
  },
  content: {
    color: "#ffffff",
    fontSize: 15,
  },
  input: {
    flex: 1,
    minHeight: 80,
    color: "#ffffff",
    textAlignVertical: "top",
  },
  deleteButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 4,
    backgroundColor: "#161c22",
  },
});

export default TaskCard;
