import { StyleSheet, View } from "react-native";

interface TrashIconProps {
  color?: string;
}

function TrashIcon({ color = "#ffffff" }: TrashIconProps) {
  return (
    <View style={styles.icon}>
      <View style={[styles.lid, { borderColor: color }]} />
      <View style={[styles.handle, { borderColor: color }]} />
      <View style={[styles.can, { borderColor: color }]}>
        <View style={[styles.line, { backgroundColor: color }]} />
        <View style={[styles.line, { backgroundColor: color }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  icon: {
    width: 22,
    height: 22,
    alignItems: "center",
  },
  handle: {
    position: "absolute",
    top: 2,
    width: 8,
    height: 4,
    borderTopWidth: 1.5,
    borderLeftWidth: 1.5,
    borderRightWidth: 1.5,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  lid: {
    position: "absolute",
    top: 7,
    width: 18,
    borderTopWidth: 1.7,
    borderRadius: 1,
  },
  can: {
    position: "absolute",
    top: 9,
    width: 14,
    height: 11,
    borderLeftWidth: 1.7,
    borderRightWidth: 1.7,
    borderBottomWidth: 1.7,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
    flexDirection: "row",
    justifyContent: "center",
    gap: 3,
    paddingTop: 2,
  },
  line: {
    width: 1.5,
    height: 7,
    borderRadius: 1,
  },
});

export default TrashIcon;
