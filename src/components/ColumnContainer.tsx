import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  PanResponder,
  type LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Reanimated, { FadeOut, LinearTransition } from "react-native-reanimated";
import TrashIcon from "../icons/TrashIcon";
import type {
  Column,
  ColumnScrollMetrics,
  Id,
  Task,
  TaskDragLayout,
  TaskListItemLayout,
} from "../types";
import TaskCard from "./TaskCard";

const TASK_ITEM_TRANSITION = LinearTransition.duration(120);
const TASK_PREVIEW_TRANSITION = LinearTransition.duration(100);

interface ColumnContainerProps {
  column: Column;
  deleteColumn: (id: Column["id"]) => void;
  updateColumn: (id: Column["id"], title: Column["title"]) => void;
  createTask: (columnId: Column["id"]) => void;
  deleteTask: (id: Task["id"]) => void;
  updateTask: (id: Task["id"], content: Task["content"]) => void;
  moveColumn: (id: Id, deltaX: number) => void;
  moveTask: (id: Id, deltaX: number, deltaY: number) => void;
  onTaskDragStart: (task: Task, layout: TaskDragLayout) => void;
  onTaskDragMove: (
    deltaX: number,
    deltaY: number,
    pointerX: number,
    pointerY: number,
  ) => void;
  onTaskDragEnd: (dropAccepted: boolean) => void;
  onTaskTouchStart: () => void;
  onTaskTouchEnd: () => void;
  onColumnLayout: (id: Id, layout: { x: number; width: number }) => void;
  onColumnScrollMetricsChange: (id: Id, metrics: ColumnScrollMetrics) => void;
  onColumnScrollYChange: (id: Id, scrollY: number) => void;
  onColumnTaskLayoutsChange: (id: Id, layouts: TaskListItemLayout[]) => void;
  editingTaskId: Id | null;
  setEditingTaskId: (id: Id | null) => void;
  taskDragPreview: {
    taskId: Id;
    targetIndex: number;
    placeholderHeight: number;
  } | null;
  draggingTaskId: Id | null;
  isTaskDragActive: boolean;
  isDropTarget: boolean;
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
  onTaskDragStart,
  onTaskDragMove,
  onTaskDragEnd,
  onTaskTouchStart,
  onTaskTouchEnd,
  onColumnLayout,
  onColumnScrollMetricsChange,
  onColumnScrollYChange,
  onColumnTaskLayoutsChange,
  editingTaskId,
  setEditingTaskId,
  taskDragPreview,
  draggingTaskId,
  isTaskDragActive,
  isDropTarget,
  tasks,
}: ColumnContainerProps) {
  const [editMode, setEditMode] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [drag] = useState(() => new Animated.ValueXY());
  const tasksScrollRef = useRef<ScrollView | null>(null);
  const scrollYRef = useRef(0);
  const contentHeightRef = useRef(0);
  const viewportHeightRef = useRef(0);
  const taskLayoutsRef = useRef(new Map<string, TaskListItemLayout>());
  const visibleTasks = useMemo(
    () => tasks.filter((task) => task.id !== draggingTaskId),
    [draggingTaskId, tasks],
  );
  const taskDropPreviewIndex =
    taskDragPreview === null
      ? null
      : Math.min(Math.max(taskDragPreview.targetIndex, 0), visibleTasks.length);

  const publishTaskLayouts = useCallback(() => {
    const layouts = visibleTasks
      .map((task) => taskLayoutsRef.current.get(String(task.id)))
      .filter((layout): layout is TaskListItemLayout => layout !== undefined);

    onColumnTaskLayoutsChange(column.id, layouts);
  }, [column.id, onColumnTaskLayoutsChange, visibleTasks]);

  const publishScrollMetrics = useCallback(() => {
    const scrollView = tasksScrollRef.current;
    if (!scrollView) return;

    const nativeScrollRef = scrollView.getNativeScrollRef();
    if (!nativeScrollRef) return;

    nativeScrollRef.measureInWindow(
      (_x: number, windowY: number, _width: number, height: number) => {
        const viewportHeight = height || viewportHeightRef.current;
        viewportHeightRef.current = viewportHeight;

        onColumnScrollMetricsChange(column.id, {
          windowY,
          viewportHeight,
          contentHeight: contentHeightRef.current,
          scrollY: scrollYRef.current,
          scrollTo: (y) => {
            scrollYRef.current = y;
            onColumnScrollYChange(column.id, y);
            scrollView.scrollTo({ y, animated: false });
          },
        });
      },
    );
  }, [column.id, onColumnScrollMetricsChange, onColumnScrollYChange]);

  useEffect(() => {
    publishScrollMetrics();
  }, [publishScrollMetrics, tasks.length]);

  useEffect(() => {
    if (isTaskDragActive || isDropTarget) {
      publishScrollMetrics();
    }
  }, [isDropTarget, isTaskDragActive, publishScrollMetrics]);

  useEffect(() => {
    const visibleTaskIds = new Set(visibleTasks.map((task) => String(task.id)));

    taskLayoutsRef.current.forEach((_layout, taskId) => {
      if (!visibleTaskIds.has(taskId)) {
        taskLayoutsRef.current.delete(taskId);
      }
    });

    publishTaskLayouts();
  }, [publishTaskLayouts, visibleTasks]);

  const handleTaskLayout = useCallback(
    (task: Task, event: LayoutChangeEvent) => {
      const { y, height } = event.nativeEvent.layout;
      const taskId = String(task.id);
      const currentLayout = taskLayoutsRef.current.get(taskId);

      if (currentLayout?.y === y && currentLayout?.height === height) {
        return;
      }

      taskLayoutsRef.current.set(taskId, {
        taskId: task.id,
        y,
        height,
      });
      publishTaskLayouts();
    },
    [publishTaskLayouts],
  );

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

  function renderTaskDropPreview() {
    if (!taskDragPreview) return null;

    return (
      <Reanimated.View
        key={`task-drop-preview-${column.id}`}
        entering={undefined}
        exiting={FadeOut.duration(60)}
        layout={TASK_PREVIEW_TRANSITION}
        style={[
          styles.taskDropPreview,
          { height: taskDragPreview.placeholderHeight },
        ]}
      />
    );
  }

  function renderTaskCard(task: Task, isDragPreviewSource = false) {
    const taskCard = (
      <TaskCard
        task={task}
        deleteTask={deleteTask}
        updateTask={updateTask}
        moveTask={moveTask}
        onTaskDragStart={onTaskDragStart}
        onTaskDragMove={onTaskDragMove}
        onTaskDragEnd={onTaskDragEnd}
        onTaskTouchStart={onTaskTouchStart}
        onTaskTouchEnd={onTaskTouchEnd}
        isDragPreviewSource={isDragPreviewSource}
        isEditing={editingTaskId === task.id}
        setEditingTaskId={setEditingTaskId}
      />
    );

    return (
      <Reanimated.View
        key={task.id}
        collapsable={false}
        entering={undefined}
        exiting={undefined}
        layout={TASK_ITEM_TRANSITION}
        onLayout={
          isDragPreviewSource
            ? undefined
            : (event) => handleTaskLayout(task, event)
        }
        style={isDragPreviewSource ? styles.hiddenTaskSlot : undefined}
      >
        {taskCard}
      </Reanimated.View>
    );
  }

  const renderedTaskItems = tasks.reduce<{
    items: ReactNode[];
    visibleTaskIndex: number;
  }>(
    (acc, task) => {
      if (task.id === draggingTaskId) {
        return {
          ...acc,
          items: [...acc.items, renderTaskCard(task, true)],
        };
      }

      const nextItems = [
        ...(taskDropPreviewIndex === acc.visibleTaskIndex
          ? [renderTaskDropPreview()]
          : []),
        renderTaskCard(task),
      ];

      return {
        items: [...acc.items, ...nextItems],
        visibleTaskIndex: acc.visibleTaskIndex + 1,
      };
    },
    { items: [], visibleTaskIndex: 0 },
  );

  return (
    <Animated.View
      onLayout={(event) => {
        const { x, width } = event.nativeEvent.layout;
        onColumnLayout(column.id, { x, width });
      }}
      style={[
        styles.column,
        isDragging && styles.draggingColumn,
        isDropTarget && styles.dropTargetColumn,
        { transform: [{ translateX: drag.x }] },
      ]}
    >
      <TouchableOpacity
        activeOpacity={0.9}
        accessibilityLabel={`Edit column ${column.title}`}
        accessibilityRole="button"
        onPress={() => {
          setEditingTaskId(null);
          setEditMode(true);
        }}
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
          accessibilityLabel={`Delete column ${column.title}`}
          accessibilityRole="button"
          onPress={(event) => {
            event.stopPropagation();
            setEditingTaskId(null);
            deleteColumn(column.id);
          }}
          style={styles.iconButton}
        >
          <TrashIcon color="#9ca3af" />
        </TouchableOpacity>
      </TouchableOpacity>

      <ScrollView
        ref={tasksScrollRef}
        collapsable={false}
        style={styles.tasks}
        contentContainerStyle={styles.tasksContent}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={!isTaskDragActive}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={(_width, height) => {
          contentHeightRef.current = height;
          publishScrollMetrics();
        }}
        onLayout={(event) => {
          viewportHeightRef.current = event.nativeEvent.layout.height;
          publishScrollMetrics();
        }}
        onScroll={(event) => {
          const scrollY = event.nativeEvent.contentOffset.y;
          scrollYRef.current = scrollY;
          onColumnScrollYChange(column.id, scrollY);
        }}
        scrollEventThrottle={16}
      >
        {renderedTaskItems.items}
        {taskDropPreviewIndex === renderedTaskItems.visibleTaskIndex &&
          renderTaskDropPreview()}
      </ScrollView>

      <TouchableOpacity
        activeOpacity={0.8}
        accessibilityLabel={`Add task to ${column.title}`}
        accessibilityRole="button"
        style={styles.footer}
        onPress={() => {
          setEditingTaskId(null);
          createTask(column.id);
        }}
      >
        <Text style={styles.footerIcon}>+</Text>
        <Text style={styles.footerText}>Add Task</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  column: {
    width: 250,
    maxHeight: 500,
    backgroundColor: "#161c22",
    borderWidth: 2,
    borderColor: "transparent",
    borderRadius: 6,
    overflow: "hidden",
  },

  draggingColumn: {
    opacity: 0.45,
    borderColor: "#f43f5e",
    zIndex: 10,
    elevation: 10,
  },

  dropTargetColumn: {
    borderColor: "#38bdf8",
    backgroundColor: "#13202a",
    shadowColor: "#38bdf8",
    shadowOpacity: 0.25,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },

  hiddenTaskSlot: {
    position: "absolute",
    left: 8,
    right: 8,
    height: 0,
  },

  tasks: {
    flexGrow: 0,
    flexShrink: 1,
  },

  tasksContent: {
    gap: 16,
    padding: 8,
  },

  taskDropPreview: {
    minHeight: 50,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: "#38bdf8",
    borderRadius: 12,
    backgroundColor: "rgba(56,189,248,0.14)",
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
    height: 40,
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
