import { useMemo, useState } from "react";
import {
  Animated,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import TrashIcon from "../icons/TrashIcon";
import type { Column, Id, Task } from "../types";
import TaskCard from "./TaskCard";

interface ColumnContainerProps {
  column: Column;
  deleteColumn: (id: Column["id"]) => void;
  updateColumn: (id: Column["id"], title: Column["title"]) => void;
  createTask: (columnId: Column["id"]) => void;
  deleteTask: (id: Task["id"]) => void;
  updateTask: (id: Task["id"], content: Task["content"]) => void;
  moveColumn: (id: Id, deltaX: number) => void;
  moveTask: (id: Id, deltaX: number, deltaY: number) => void;
  tasks: Task[];
}

function ColumnContainer({
  column,
  deleteColumn,
  updateColumn,
  createTask,
  deleteTask,
  updateTask,
  moveColumn,
  moveTask,
  tasks,
}: ColumnContainerProps) {
  const [editMode, setEditMode] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [drag] = useState(() => new Animated.ValueXY());

  const columnPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          !editMode && Math.abs(gesture.dx) > 4,
        onPanResponderGrant: () => {
          setIsDragging(true);
          drag.setOffset({ x: 0, y: 0 });
          drag.setValue({ x: 0, y: 0 });
        },
        onPanResponderMove: Animated.event([null, { dx: drag.x }], {
          useNativeDriver: false,
        }),
        onPanResponderRelease: (_, gesture) => {
          setIsDragging(false);
          drag.flattenOffset();
          drag.setValue({ x: 0, y: 0 });
          moveColumn(column.id, gesture.dx);
        },
        onPanResponderTerminate: () => {
          setIsDragging(false);
          drag.flattenOffset();
          drag.setValue({ x: 0, y: 0 });
        },
      }),
    [column.id, drag, editMode, moveColumn],
  );

  return (
    <Animated.View
      style={[
        styles.column,
        isDragging && styles.draggingColumn,
        { transform: [{ translateX: drag.x }] },
      ]}
    >
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => setEditMode(true)}
        style={styles.header}
        {...columnPanResponder.panHandlers}
      >
        <View style={styles.titleGroup}>
          <View style={styles.counter}>
            <Text style={styles.counterText}>{tasks.length}</Text>
          </View>
          {!editMode && <Text style={styles.title}>{column.title}</Text>}
          {editMode && (
            <TextInput
              value={column.title}
              autoFocus
              onChangeText={(title) => updateColumn(column.id, title)}
              onBlur={() => setEditMode(false)}
              onSubmitEditing={() => setEditMode(false)}
              style={styles.titleInput}
              selectionColor="#f43f5e"
            />
          )}
        </View>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => deleteColumn(column.id)}
          style={styles.iconButton}
        >
          <TrashIcon color="#9ca3af" />
        </TouchableOpacity>
      </TouchableOpacity>

      <ScrollView
        style={styles.tasks}
        contentContainerStyle={styles.tasksContent}
        showsVerticalScrollIndicator={false}
      >
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            deleteTask={deleteTask}
            updateTask={updateTask}
            moveTask={moveTask}
          />
        ))}
      </ScrollView>

      <TouchableOpacity
        activeOpacity={0.8}
        style={styles.footer}
        onPress={() => createTask(column.id)}
      >
        <Text style={styles.footerIcon}>+</Text>
        <Text style={styles.footerText}>Add Task</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  column: {
    width: 350,
    height: 500,
    maxHeight: 500,
    backgroundColor: "#161c22",
    borderRadius: 6,
  },
  draggingColumn: {
    opacity: 0.45,
    borderWidth: 2,
    borderColor: "#f43f5e",
    zIndex: 10,
  },
  header: {
    height: 60,
    padding: 12,
    borderWidth: 4,
    borderColor: "#161c22",
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    backgroundColor: "#0d1117",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  titleGroup: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  counter: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    backgroundColor: "#0d1117",
  },
  counterText: {
    color: "#ffffff",
    fontSize: 14,
  },
  title: {
    flex: 1,
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },
  titleInput: {
    flex: 1,
    height: 36,
    color: "#ffffff",
    borderWidth: 1,
    borderColor: "#f43f5e",
    borderRadius: 4,
    paddingHorizontal: 8,
    backgroundColor: "#000000",
  },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 4,
  },
  tasks: {
    flex: 1,
  },
  tasksContent: {
    gap: 16,
    padding: 8,
  },
  footer: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 16,
    borderWidth: 2,
    borderColor: "#161c22",
    borderRadius: 6,
  },
  footerIcon: {
    color: "#ffffff",
    fontSize: 24,
    lineHeight: 24,
  },
  footerText: {
    color: "#ffffff",
    fontSize: 16,
  },
});

export default ColumnContainer;
