import { StyleSheet, View } from "react-native";

interface CloseIconProps {
  color?: string;
}

function CloseIcon({ color = "#ffffff" }: CloseIconProps) {
  return (
    <View style={styles.icon}>
      <View style={[styles.line, styles.lineForward, { backgroundColor: color }]} />
      <View style={[styles.line, styles.lineBackward, { backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  icon: {
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  line: {
    position: "absolute",
    width: 18,
    height: 2,
    borderRadius: 1,
  },
  lineForward: {
    transform: [{ rotateZ: "45deg" }],
  },
  lineBackward: {
    transform: [{ rotateZ: "-45deg" }],
  },
});

export default CloseIcon;
