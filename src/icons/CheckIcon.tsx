import { StyleSheet, View } from "react-native";

interface CheckIconProps {
  color?: string;
}

function CheckIcon({ color = "#ffffff" }: CheckIconProps) {
  return (
    <View style={styles.icon}>
      <View style={[styles.shortLine, { backgroundColor: color }]} />
      <View style={[styles.longLine, { backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  icon: {
    width: 20,
    height: 18,
  },
  shortLine: {
    position: "absolute",
    left: 2,
    top: 9,
    width: 8,
    height: 2,
    borderRadius: 1,
    transform: [{ rotateZ: "45deg" }],
  },
  longLine: {
    position: "absolute",
    left: 7,
    top: 7,
    width: 13,
    height: 2,
    borderRadius: 1,
    transform: [{ rotateZ: "-45deg" }],
  },
});

export default CheckIcon;
