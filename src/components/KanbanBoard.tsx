import { useCallback, useMemo, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Column, Id, Task } from "../types";
import ColumnContainer from "./ColumnContainer";
import TaskCard from "./TaskCard";

const COLUMN_WIDTH = 250;
const COLUMN_GAP = 16;
const TASK_HEIGHT = 100;
const TASK_GAP = 16;

type TaskDragState = {
  task: Task;
  startX: number;
  startY: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function arrayMove<T>(items: T[], from: number, to: number) {
  const nextItems = [...items];
  const [item] = nextItems.splice(from, 1);
  nextItems.splice(to, 0, item);
  return nextItems;
}

function KanbanBoard() {
  const [columns, setColumns] = useState<Column[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [editingTaskId, setEditingTaskId] = useState<Id | null>(null);
  const [activeTaskDrag, setActiveTaskDrag] = useState<TaskDragState | null>(
    null,
  );
  const [isTouchingTask, setIsTouchingTask] = useState(false);

  const tasksByColumn = useMemo(
    () =>
      columns.reduce<Record<string, Task[]>>((acc, column) => {
        acc[String(column.id)] = tasks.filter(
          (task) => task.columnId === column.id,
        );
        return acc;
      }, {}),
    [columns, tasks],
  );

  function generateId() {
    return Math.random().toString(36).substring(2, 10);
  }

  function createColumn() {
    setEditingTaskId(null);

    const columnToAdd: Column = {
      id: generateId(),
      title: `Column ${columns.length + 1}`,
    };
    setColumns([...columns, columnToAdd]);
  }

  function deleteColumn(id: Id) {
    setEditingTaskId(null);

    const filteredColumns = columns.filter((col) => col.id !== id);
    setColumns(filteredColumns);

    const newTasks = tasks.filter((task) => task.columnId !== id);
    setTasks(newTasks);
  }

  function updateColumn(id: Id, title: Column["title"]) {
    const newColumns = columns.map((col) => {
      if (col.id !== id) return col;
      return {
        ...col,
        title,
      };
    });
    setColumns(newColumns);
  }

  function createTask(columnId: Id) {
    setEditingTaskId(null);

    const newTask: Task = {
      id: generateId(),
      columnId,
      content: `Task ${tasks.length + 1}`,
    };
    setTasks([...tasks, newTask]);
  }

  function deleteTask(id: Id) {
    if (editingTaskId === id) {
      setEditingTaskId(null);
    }

    const newTasks = tasks.filter((task) => task.id !== id);
    setTasks(newTasks);
  }

  function updateTask(id: Id, content: Task["content"]) {
    const newTasks = tasks.map((task) => {
      if (task.id !== id) return task;
      return {
        ...task,
        content,
      };
    });
    setTasks(newTasks);
  }

  const moveColumn = useCallback((id: Id, deltaX: number) => {
    setColumns((currentColumns) => {
      const fromIndex = currentColumns.findIndex((column) => column.id === id);
      if (fromIndex === -1) return currentColumns;

      const indexOffset = Math.round(deltaX / (COLUMN_WIDTH + COLUMN_GAP));
      const toIndex = clamp(
        fromIndex + indexOffset,
        0,
        currentColumns.length - 1,
      );

      if (fromIndex === toIndex) return currentColumns;
      return arrayMove(currentColumns, fromIndex, toIndex);
    });
  }, []);

  const moveTask = useCallback((taskId: Id, deltaX: number, deltaY: number) => {
    setTasks((currentTasks) => {
      const task = currentTasks.find((item) => item.id === taskId);
      if (!task) return currentTasks;

      const sourceColumnIndex = columns.findIndex(
        (column) => column.id === task.columnId,
      );
      if (sourceColumnIndex === -1) return currentTasks;

      const targetColumnIndex = clamp(
        sourceColumnIndex + Math.round(deltaX / (COLUMN_WIDTH + COLUMN_GAP)),
        0,
        columns.length - 1,
      );
      const targetColumn = columns[targetColumnIndex];
      const sourceTasks = currentTasks.filter(
        (item) => item.columnId === task.columnId,
      );
      const sourceTaskIndex = sourceTasks.findIndex(
        (item) => item.id === taskId,
      );

      if (sourceTaskIndex === -1) return currentTasks;

      const targetTasksWithoutDragged = currentTasks.filter(
        (item) => item.columnId === targetColumn.id && item.id !== taskId,
      );
      const targetTaskIndex = clamp(
        sourceTaskIndex + Math.round(deltaY / (TASK_HEIGHT + TASK_GAP)),
        0,
        targetTasksWithoutDragged.length,
      );

      const taskToMove = { ...task, columnId: targetColumn.id };
      const remainingTasks = currentTasks.filter((item) => item.id !== taskId);
      const rebuiltTasks: Task[] = [];

      columns.forEach((column) => {
        const columnTasks = remainingTasks.filter(
          (item) => item.columnId === column.id,
        );

        if (column.id === targetColumn.id) {
          columnTasks.splice(targetTaskIndex, 0, taskToMove);
        }

        rebuiltTasks.push(...columnTasks);
      });

      return rebuiltTasks;
    });
  }, [columns]);

  const handleTaskDragStart = useCallback(
    (
      task: Task,
      layout: { x: number; y: number; width: number; height: number },
    ) => {
      setEditingTaskId(null);

      setActiveTaskDrag({
        task,
        startX: layout.x,
        startY: layout.y,
        x: layout.x,
        y: layout.y,
        width: layout.width,
        height: layout.height,
      });
    },
    [],
  );

  const handleTaskDragMove = useCallback((deltaX: number, deltaY: number) => {
    setActiveTaskDrag((currentDrag) => {
      if (!currentDrag) return currentDrag;

      return {
        ...currentDrag,
        x: currentDrag.startX + deltaX,
        y: currentDrag.startY + deltaY,
      };
    });
  }, []);

  const handleTaskDragEnd = useCallback(() => {
    setActiveTaskDrag(null);
    setIsTouchingTask(false);
  }, []);

  const handleTaskTouchStart = useCallback(() => {
    setIsTouchingTask(true);
  }, []);

  const handleTaskTouchEnd = useCallback(() => {
    setIsTouchingTask(false);
  }, []);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        horizontal
        style={styles.boardScroll}
        scrollEnabled={!isTouchingTask}
        directionalLockEnabled
        contentContainerStyle={styles.board}
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={() => setEditingTaskId(null)}
        showsHorizontalScrollIndicator={false}
      >
        <View style={styles.columns}>
          {columns.map((col) => (
            <ColumnContainer
              key={col.id}
              column={col}
              deleteColumn={deleteColumn}
              updateColumn={updateColumn}
              createTask={createTask}
              deleteTask={deleteTask}
              updateTask={updateTask}
              moveColumn={moveColumn}
              moveTask={moveTask}
              onTaskDragStart={handleTaskDragStart}
              onTaskDragMove={handleTaskDragMove}
              onTaskDragEnd={handleTaskDragEnd}
              onTaskTouchStart={handleTaskTouchStart}
              onTaskTouchEnd={handleTaskTouchEnd}
              editingTaskId={editingTaskId}
              setEditingTaskId={setEditingTaskId}
              tasks={tasksByColumn[String(col.id)] ?? []}
            />
          ))}
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={createColumn}
            style={styles.addColumnButton}
          >
            <Text style={styles.addIcon}>+</Text>
            <Text style={styles.addColumnText}>Add Column</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      <View pointerEvents="none" style={styles.dragOverlay}>
        {activeTaskDrag && (
          <View
            style={[
              styles.draggedTask,
              {
                width: activeTaskDrag.width,
                height: activeTaskDrag.height,
                transform: [
                  { translateX: activeTaskDrag.x },
                  { translateY: activeTaskDrag.y },
                ],
              },
            ]}
          >
            <TaskCard
              task={activeTaskDrag.task}
              deleteTask={deleteTask}
              updateTask={updateTask}
              moveTask={moveTask}
              isEditing={false}
              isOverlay
              setEditingTaskId={setEditingTaskId}
            />
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    position: "relative",
    backgroundColor: "#000000",
  },
  boardScroll: {
    flex: 1,
  },
  board: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
  },
  columns: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: COLUMN_GAP,
  },
  addColumnButton: {
    width: COLUMN_WIDTH,
    minWidth: COLUMN_WIDTH,
    height: 60,
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    padding: 16,
    borderWidth: 2,
    borderColor: "#161c22",
    borderRadius: 8,
    backgroundColor: "#0d1117",
  },
  addIcon: {
    color: "#ffffff",
    fontSize: 28,
    lineHeight: 28,
  },
  addColumnText: {
    color: "#ffffff",
    fontSize: 16,
  },
  dragOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 99999,
    elevation: 99999,
    overflow: "visible",
  },

  draggedTask: {
    position: "absolute",
    left: 0,
    top: 0,
    zIndex: 99999,
    elevation: 99999,
  },
});

export default KanbanBoard;
