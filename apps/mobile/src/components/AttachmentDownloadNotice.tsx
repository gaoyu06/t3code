import { useGT } from "gt-react-native";
import { Platform } from "react-native";
import Animated, { FadeIn, FadeOut, ReduceMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FullWindowOverlay } from "react-native-screens";

import { useAttachmentDownloadActivity } from "../lib/attachmentDownloadProgress";
import { formatBytes } from "../lib/formatBytes";
import { MOBILE_MOTION } from "../lib/designTokens";
import { Toast } from "./ui/Toast";

/** Shows the running attachment download above every screen and sheet, with a way to cancel it. */
export function AttachmentDownloadNotice() {
  const gt = useGT();
  const top = useSafeAreaInsets().top + 8;
  const activity = useAttachmentDownloadActivity();
  if (!activity) return null;
  const { bytesWritten, totalBytes } = activity;
  const description =
    totalBytes === null
      ? gt("Downloading · {received}", { received: formatBytes(bytesWritten) })
      : gt("Downloading · {received} of {total}", {
          received: formatBytes(bytesWritten),
          total: formatBytes(totalBytes),
        });
  const notice = (
    <Animated.View
      key={activity.id}
      entering={FadeIn.duration(MOBILE_MOTION.enter).reduceMotion(ReduceMotion.System)}
      exiting={FadeOut.duration(MOBILE_MOTION.exit).reduceMotion(ReduceMotion.System)}
      className="absolute inset-x-3 z-[100]"
      style={{ top }}
      pointerEvents="box-none"
    >
      <Toast
        busy
        message={activity.name}
        description={description}
        {...(totalBytes === null ? {} : { progress: bytesWritten / totalBytes })}
        action={{ label: gt("Cancel"), onPress: activity.cancel }}
      />
    </Animated.View>
  );
  return Platform.OS === "ios" ? <FullWindowOverlay>{notice}</FullWindowOverlay> : notice;
}
