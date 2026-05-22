import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  PanResponder,
  type LayoutChangeEvent,
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

const TASK_PREVIEW_TRANSITION = LinearTransition.springify()
  .damping(20)
  .mass(0.6)
  .stiffness(300);
const MAGNETIC_CARD_SPRING = {
  tension: 210,
  friction: 18,
  useNativeDriver: true,
};
const DENSITY_MODE_BY_ZOOM = {
  compact: "compact",
  normal: "normal",
} as const;

interface MagneticTaskItemProps {
  children: ReactNode;
  dropAnimation: {
    taskId: Id;
    fromX: number;
    fromY: number;
    nonce: number;
  } | null;
  isDragPreviewSource: boolean;
  onDropAnimationEnd: (taskId: Id, nonce: number) => void;
  onDropAnimationStart: (taskId: Id, nonce: number) => void;
  onTaskLayout: (task: Task, event: LayoutChangeEvent) => void;
  shouldAnimateTaskLayout: boolean;
  task: Task;
}

function MagneticTaskItem({
  children,
  dropAnimation,
  isDragPreviewSource,
  onDropAnimationEnd,
  onDropAnimationStart,
  onTaskLayout,
  shouldAnimateTaskLayout,
  task,
}: MagneticTaskItemProps) {
  const itemRef = useRef<View | null>(null);
  const [magnetX] = useState(() => new Animated.Value(0));
  const [magnetY] = useState(() => new Animated.Value(0));
  const previousLayoutRef = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const consumedDropAnimationRef = useRef<number | null>(null);
  const [visibleDropAnimationNonce, setVisibleDropAnimationNonce] =
    useState<number | null>(null);
  const shouldHideForDropAnimation =
    dropAnimation?.taskId === task.id &&
    dropAnimation.nonce !== visibleDropAnimationNonce;

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { x, y, width, height } = event.nativeEvent.layout;
      const previousLayout = previousLayoutRef.current;

      onTaskLayout(task, event);
      previousLayoutRef.current = { x, y, width, height };

      if (
        dropAnimation &&
        dropAnimation.taskId === task.id &&
        consumedDropAnimationRef.current !== dropAnimation.nonce
      ) {
        consumedDropAnimationRef.current = dropAnimation.nonce;

        requestAnimationFrame(() => {
          itemRef.current?.measureInWindow((windowX, windowY) => {
            magnetX.stopAnimation();
            magnetY.stopAnimation();
            magnetX.setValue(dropAnimation.fromX - windowX);
            magnetY.setValue(dropAnimation.fromY - windowY);
            setVisibleDropAnimationNonce(dropAnimation.nonce);
            onDropAnimationStart(task.id, dropAnimation.nonce);

            Animated.parallel([
              Animated.spring(magnetX, {
                ...MAGNETIC_CARD_SPRING,
                toValue: 0,
              }),
              Animated.spring(magnetY, {
                ...MAGNETIC_CARD_SPRING,
                toValue: 0,
              }),
            ]).start(({ finished }) => {
              if (finished) {
                onDropAnimationEnd(task.id, dropAnimation.nonce);
              }
            });
          });
        });

        return;
      }

      if (!previousLayout || !shouldAnimateTaskLayout || dropAnimation?.taskId === task.id) {
        magnetX.stopAnimation();
        magnetY.stopAnimation();
        magnetX.setValue(0);
        magnetY.setValue(0);
        return;
      }

      const deltaX = previousLayout.x - x;
      const deltaY = previousLayout.y - y;

      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;

      magnetX.stopAnimation();
      magnetY.stopAnimation();
      magnetX.setValue(deltaX);
      magnetY.setValue(deltaY);
      Animated.parallel([
        Animated.spring(magnetX, {
          ...MAGNETIC_CARD_SPRING,
          toValue: 0,
        }),
        Animated.spring(magnetY, {
          ...MAGNETIC_CARD_SPRING,
          toValue: 0,
        }),
      ]).start();
    },
    [
      dropAnimation,
      magnetX,
      magnetY,
      onDropAnimationEnd,
      onDropAnimationStart,
      onTaskLayout,
      shouldAnimateTaskLayout,
      task,
    ],
  );

  return (
    <Animated.View
      ref={itemRef}
      collapsable={false}
      onLayout={isDragPreviewSource ? undefined : handleLayout}
      style={[
        isDragPreviewSource ? styles.hiddenTaskSlot : undefined,
        !isDragPreviewSource
          ? { transform: [{ translateX: magnetX }, { translateY: magnetY }] }
          : undefined,
        shouldHideForDropAnimation ? styles.hiddenDropAnimationCard : undefined,
      ]}
    >
      {children}
    </Animated.View>
  );
}

interface ColumnContainerProps {
  column: Column;
  columnWidth: number;
  deleteColumn: (id: Column["id"]) => void;
  updateColumn: (id: Column["id"], title: Column["title"]) => void;
  startAddingTask: (columnId: Column["id"]) => void;
  deleteTask: (id: Task["id"]) => void;
  addTaskTitle: string;
  isAddingTask: boolean;
  onAddTaskTitleChange: (title: string) => void;
  onSubmitAddingTask: () => void;
  onOpenTaskDetails: (id: Task["id"]) => void;
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
  dropTaskAnimation: {
    taskId: Id;
    fromX: number;
    fromY: number;
    nonce: number;
  } | null;
  onDropTaskAnimationEnd: (taskId: Id, nonce: number) => void;
  onDropTaskAnimationStart: (taskId: Id, nonce: number) => void;
  taskDragPreview: {
    taskId: Id;
    targetIndex: number;
    placeholderHeight: number;
  } | null;
  draggingTaskId: Id | null;
  isTaskDragActive: boolean;
  isDropTarget: boolean;
  isZoomedOut: boolean;
  shouldAnimateTaskLayout: boolean;
  tasks: Task[];
}

function ColumnContainer({
  column,
  columnWidth,
  deleteColumn,
  updateColumn,
  startAddingTask,
  deleteTask,
  addTaskTitle,
  isAddingTask,
  onAddTaskTitleChange,
  onSubmitAddingTask,
  onOpenTaskDetails,
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
  dropTaskAnimation,
  onDropTaskAnimationEnd,
  onDropTaskAnimationStart,
  taskDragPreview,
  draggingTaskId,
  isTaskDragActive,
  isDropTarget,
  isZoomedOut,
  shouldAnimateTaskLayout,
  tasks,
}: ColumnContainerProps) {
  const [editMode, setEditMode] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [drag] = useState(() => new Animated.ValueXY());
  const tasksListRef = useRef<View | null>(null);
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
  const densityMode = isZoomedOut
    ? DENSITY_MODE_BY_ZOOM.compact
    : DENSITY_MODE_BY_ZOOM.normal;

  const publishTaskLayouts = useCallback(() => {
    const layouts = visibleTasks
      .map((task) => taskLayoutsRef.current.get(task.id))
      .filter((layout): layout is TaskListItemLayout => layout !== undefined);

    onColumnTaskLayoutsChange(column.id, layouts);
  }, [column.id, onColumnTaskLayoutsChange, visibleTasks]);

  const publishScrollMetrics = useCallback(() => {
    const tasksList = tasksListRef.current;
    if (!tasksList) return;

    tasksList.measureInWindow(
      (_x: number, windowY: number, _width: number, height: number) => {
        const viewportHeight = height || viewportHeightRef.current;
        viewportHeightRef.current = viewportHeight;

        onColumnScrollMetricsChange(column.id, {
          windowY,
          viewportHeight,
          contentHeight: contentHeightRef.current || viewportHeight,
          scrollY: 0,
          scrollTo: () => {
            onColumnScrollYChange(column.id, 0);
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
    const visibleTaskIds = new Set(visibleTasks.map((task) => task.id));

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
      const taskId = task.id;
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
        key={`task-drop-preview-${column.id}-${densityMode}`}
        entering={undefined}
        exiting={FadeOut.duration(60)}
        layout={shouldAnimateTaskLayout ? TASK_PREVIEW_TRANSITION : undefined}
        style={[
          styles.taskDropPreview,
          isZoomedOut && styles.compactTaskDropPreview,
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
        moveTask={moveTask}
        isZoomedOut={isZoomedOut}
        onOpenTaskDetails={onOpenTaskDetails}
        onTaskDragStart={onTaskDragStart}
        onTaskDragMove={onTaskDragMove}
        onTaskDragEnd={onTaskDragEnd}
        onTaskTouchStart={onTaskTouchStart}
        onTaskTouchEnd={onTaskTouchEnd}
        isDragPreviewSource={isDragPreviewSource}
      />
    );

    return (
      <MagneticTaskItem
        key={`${task.id}-${densityMode}`}
        dropAnimation={
          dropTaskAnimation?.taskId === task.id ? dropTaskAnimation : null
        }
        isDragPreviewSource={isDragPreviewSource}
        onDropAnimationEnd={onDropTaskAnimationEnd}
        onDropAnimationStart={onDropTaskAnimationStart}
        onTaskLayout={handleTaskLayout}
        shouldAnimateTaskLayout={shouldAnimateTaskLayout}
        task={task}
      >
        {taskCard}
      </MagneticTaskItem>
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
        { width: columnWidth },
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
          setEditMode(true);
        }}
        style={[styles.header, isZoomedOut && styles.compactHeader]}
        {...columnPanResponder.panHandlers}
      >
        <View style={styles.titleGroup}>
          <View style={[styles.counter, isZoomedOut && styles.compactCounter]}>
            <Text
              style={[
                styles.counterText,
                isZoomedOut && styles.compactCounterText,
              ]}
            >
              {tasks.length}
            </Text>
          </View>
          {!editMode && (
            <Text style={[styles.title, isZoomedOut && styles.compactTitle]}>
              {column.title}
            </Text>
          )}
          {editMode && (
            <TextInput
              value={column.title}
              autoFocus
              onChangeText={(title) => updateColumn(column.id, title)}
              onBlur={() => setEditMode(false)}
              onSubmitEditing={() => setEditMode(false)}
              style={[
                styles.titleInput,
                isZoomedOut && styles.compactTitleInput,
              ]}
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
            deleteColumn(column.id);
          }}
          style={[styles.iconButton, isZoomedOut && styles.compactIconButton]}
        >
          <TrashIcon color="#9ca3af" size={isZoomedOut ? 14 : 18} />
        </TouchableOpacity>
      </TouchableOpacity>

      <View
        ref={tasksListRef}
        collapsable={false}
        style={[styles.tasks, isZoomedOut && styles.compactTasks]}
        onLayout={(event) => {
          const height = event.nativeEvent.layout.height;
          contentHeightRef.current = height;
          viewportHeightRef.current = height;
          onColumnScrollYChange(column.id, 0);
          publishScrollMetrics();
        }}
      >
        {renderedTaskItems.items}
        {taskDropPreviewIndex === renderedTaskItems.visibleTaskIndex &&
          renderTaskDropPreview()}
        {isAddingTask && (
          <TextInput
            value={addTaskTitle}
            autoFocus
            placeholder="Card title"
            placeholderTextColor="#8b949e"
            onChangeText={onAddTaskTitleChange}
            onSubmitEditing={onSubmitAddingTask}
            returnKeyType="done"
            style={[
              styles.addTaskInput,
              isZoomedOut && styles.compactAddTaskInput,
            ]}
            selectionColor="#f43f5e"
          />
        )}
      </View>

      {!isAddingTask && (
        <TouchableOpacity
          activeOpacity={0.8}
          accessibilityLabel={`Add task to ${column.title}`}
          accessibilityRole="button"
          style={[styles.footer, isZoomedOut && styles.compactFooter]}
          onPress={() => {
            startAddingTask(column.id);
          }}
        >
          <Text
            style={[styles.footerIcon, isZoomedOut && styles.compactFooterIcon]}
          >
            +
          </Text>
          <Text
            style={[styles.footerText, isZoomedOut && styles.compactFooterText]}
          >
            Add Task
          </Text>
        </TouchableOpacity>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  column: {
    width: 250,
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
  hiddenDropAnimationCard: {
    opacity: 0,
  },

  tasks: {
    gap: 12,
    padding: 8,
  },
  compactTasks: {
    gap: 8,
    padding: 6,
  },

  addTaskInput: {
    minHeight: 50,
    color: "#ffffff",
    fontSize: 15,
    padding: 10,
    borderWidth: 2,
    borderColor: "#30363d",
    borderRadius: 12,
    backgroundColor: "#0d1117",
  },
  compactAddTaskInput: {
    minHeight: 38,
    fontSize: 12,
    padding: 8,
    borderRadius: 8,
  },

  taskDropPreview: {
    minHeight: 50,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: "#38bdf8",
    borderRadius: 12,
    backgroundColor: "rgba(56,189,248,0.14)",
  },
  compactTaskDropPreview: {
    minHeight: 38,
    borderRadius: 8,
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
  compactHeader: {
    height: 48,
    padding: 8,
    borderWidth: 3,
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
  compactCounter: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 6,
  },

  counterText: {
    color: "#ffffff",
    fontSize: 14,
  },
  compactCounterText: {
    fontSize: 12,
  },

  title: {
    flex: 1,
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },
  compactTitle: {
    fontSize: 13,
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
  compactTitleInput: {
    height: 34,
    fontSize: 13,
    paddingHorizontal: 6,
  },

  iconButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 4,
  },
  compactIconButton: {
    width: 30,
    height: 30,
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
  compactFooter: {
    minHeight: 44,
    gap: 6,
    padding: 10,
  },

  footerIcon: {
    color: "#ffffff",
    fontSize: 24,
    lineHeight: 24,
  },
  compactFooterIcon: {
    fontSize: 20,
    lineHeight: 20,
  },

  footerText: {
    color: "#ffffff",
    fontSize: 16,
  },
  compactFooterText: {
    fontSize: 13,
  },
});

export default ColumnContainer;
