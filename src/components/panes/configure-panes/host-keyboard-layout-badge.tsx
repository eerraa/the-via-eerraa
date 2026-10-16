import {BadgeDropdown} from '../../inputs/badge-dropdown';
import {useAppDispatch, useAppSelector} from 'src/store/hooks';
import {
  getHostKeyboardLayout,
  updateHostKeyboardLayout,
} from 'src/store/settingsSlice';
import {keymapExtras} from 'src/utils/keymap-extras';

const layoutOptions = Object.entries(keymapExtras).map(([key, value]) => ({
  value: key,
  label: value.label,
}));

export const HostKeyboardLayoutBadge = () => {
  const dispatch = useAppDispatch();
  const hostKeyboardLayout = useAppSelector(getHostKeyboardLayout);

  const currentLabel =
    keymapExtras[hostKeyboardLayout]?.label ?? hostKeyboardLayout;

  return (
    <BadgeDropdown
      label={currentLabel}
      title={currentLabel}
      value={hostKeyboardLayout}
      options={layoutOptions}
      onChange={(value) => dispatch(updateHostKeyboardLayout(value))}
    />
  );
};
