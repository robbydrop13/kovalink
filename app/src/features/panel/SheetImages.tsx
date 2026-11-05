// Les images d'une option de fiche (avant / apres une decision d'interface), cote a cote
// sous l'option. Chaque image se lit sur le Mac par `fs/read`, jeton en en-tete : sa
// taille d'abord (`fileSize`, qui rapporte aussi un refus de la liste noire avec sa
// cause), puis l'image. Ce qui ne s'affiche pas devient une note, jamais une erreur de la
// fiche. Un appui l'agrandit en plein ecran, pincer zoome, un appui ferme.
import { useEffect, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SHEET_IMAGE_BYTES_MAX, type SheetImage } from '@/protocol';
import { t } from '@/i18n/en';
import { fileSize, fileUrl } from '@/net/files';
import { colors, radius, space } from '@/theme';
import { Icon } from '@/ui/Icon';
import { Txt } from '@/ui/Txt';
import { imageName, planImages } from './imagePlan';

type Remote = { url: string; headers: Record<string, string> };
type Shot = { state: 'loading' } | { state: 'ready'; remote: Remote } | { state: 'skipped'; note: string };

export function SheetImages({ images }: { images: readonly SheetImage[] | undefined }) {
  const [open, setOpen] = useState<{ image: SheetImage; remote: Remote } | null>(null);
  const plan = planImages(images);
  if (plan.shown.length === 0 && plan.notes.length === 0) return null;
  return (
    <View style={styles.root}>
      {plan.shown.length > 0 ? (
        <View style={styles.row}>
          {plan.shown.map((image) => (
            <SheetShot key={image.path} image={image} onOpen={(remote) => setOpen({ image, remote })} />
          ))}
        </View>
      ) : null}
      {plan.notes.map((note) => (
        <Txt key={note} variant="footnote" color={colors.text.tertiary}>
          {note}
        </Txt>
      ))}
      <Lightbox open={open} onClose={() => setOpen(null)} />
    </View>
  );
}

function SheetShot({ image, onOpen }: { image: SheetImage; onOpen: (remote: Remote) => void }) {
  const [shot, setShot] = useState<Shot>({ state: 'loading' });
  useEffect(() => {
    let alive = true;
    const skip = (why: string): void => {
      if (alive) setShot({ state: 'skipped', note: t.panelSheetImageNotShown(imageName(image), why) });
    };
    void (async () => {
      try {
        const size = await fileSize(image.path);
        if (size > SHEET_IMAGE_BYTES_MAX) return skip(t.panelSheetImageTooLarge(SHEET_IMAGE_BYTES_MAX / (1024 * 1024)));
        const remote = await fileUrl(image.path);
        if (alive) setShot({ state: 'ready', remote });
      } catch (e) {
        skip(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [image]);

  const label = image.label.trim();
  return (
    <View style={styles.shot}>
      {label ? (
        <Txt variant="caption" color={colors.text.tertiary} style={styles.label} numberOfLines={1}>
          {label}
        </Txt>
      ) : null}
      {shot.state === 'skipped' ? (
        <Txt variant="footnote" color={colors.text.tertiary}>
          {shot.note}
        </Txt>
      ) : (
        <Pressable
          accessibilityRole="imagebutton"
          accessibilityLabel={t.panelSheetImageA11y(label || imageName(image))}
          disabled={shot.state !== 'ready'}
          onPress={() => shot.state === 'ready' && onOpen(shot.remote)}
          style={styles.frame}
        >
          {shot.state === 'ready' ? (
            <Image
              source={{ uri: shot.remote.url, headers: shot.remote.headers }}
              style={styles.thumb}
              resizeMode="contain"
              onError={() => setShot({ state: 'skipped', note: t.panelSheetImageNotShown(imageName(image), t.panelSheetImageUnreadable) })}
            />
          ) : null}
        </Pressable>
      )}
    </View>
  );
}

function Lightbox({ open, onClose }: { open: { image: SheetImage; remote: Remote } | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open !== null} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.lightbox}>
        {open ? (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.zoom}
            maximumZoomScale={4}
            minimumZoomScale={1}
            centerContent
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
          >
            <Pressable style={styles.flex} onPress={onClose} accessibilityLabel={t.panelSheetImageClose}>
              <Image
                source={{ uri: open.remote.url, headers: open.remote.headers }}
                style={styles.full}
                resizeMode="contain"
                accessibilityLabel={imageName(open.image)}
              />
            </Pressable>
          </ScrollView>
        ) : null}
        {open?.image.label.trim() ? (
          <Txt variant="callout" color={colors.text.onFill} style={[styles.caption, { bottom: insets.bottom + space[4] }]}>
            {open.image.label.trim()}
          </Txt>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.panelSheetImageClose}
          onPress={onClose}
          hitSlop={12}
          style={[styles.close, { top: insets.top + space[3] }]}
        >
          <Icon name="x" size={22} color={colors.text.onFill} />
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: { gap: space[2], marginTop: space[2] },
  row: { flexDirection: 'row', gap: space[2] },
  shot: { flex: 1, gap: space[1], minWidth: 0 },
  label: { textTransform: 'uppercase' },
  frame: {
    height: 140,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    backgroundColor: colors.bg.inset,
    overflow: 'hidden',
  },
  thumb: { width: '100%', height: '100%' },
  lightbox: { flex: 1, backgroundColor: '#000000' },
  zoom: { flexGrow: 1 },
  full: { width: '100%', height: '100%' },
  caption: { position: 'absolute', left: space[4], right: space[4], textAlign: 'center' },
  close: {
    position: 'absolute',
    right: space[4],
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.scrim,
  },
});
