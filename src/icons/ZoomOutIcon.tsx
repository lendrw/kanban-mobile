import { StyleSheet, View } from "react-native";

interface ZoomOutIconProps {
  color?: string;
}

function ZoomOutIcon({ color = "#ffffff" }: ZoomOutIconProps) {
  return (
    <View style={styles.icon}>
      <View style={[styles.lens, { borderColor: color }]}>
        <View style={[styles.minus, { backgroundColor: color }]} />
      </View>
      <View style={[styles.handle, { backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  icon: {
    width: 22,
    height: 22,
  },
  lens: {
    position: "absolute",
    left: 1,
    top: 1,
    width: 15,
    height: 15,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderRadius: 8,
  },
  minus: {
    width: 7,
    height: 2,
    borderRadius: 1,
  },
  handle: {
    position: "absolute",
    right: 2,
    bottom: 3,
    width: 8,
    height: 2,
    borderRadius: 1,
    transform: [{ rotateZ: "45deg" }],
  },
});

export default ZoomOutIcon;
