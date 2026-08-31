import {useMemo} from 'react';
import {useTranslation} from 'react-i18next';
import {type MillisecondAdapter} from '../../utils/millisecond-field';
import {IntegerInput} from './integer-input';
import {
  integerFailureMessage,
  type IntegerParseFailure,
} from '../../utils/integer-field';

type Props = {
  adapter: MillisecondAdapter;
  id?: string;
  ariaLabel?: string;
  savedMs: number;
};

export const MillisecondInput = ({adapter, id, ariaLabel, savedMs}: Props) => {
  const {t} = useTranslation();
  const integerAdapter = useMemo(
    () => ({
      min: adapter.minMs,
      max: adapter.maxMs,
      write: adapter.write,
    }),
    [adapter],
  );
  const failureMessage = (reason: IntegerParseFailure) =>
    reason === 'non_integer'
      ? 'Fractional milliseconds are not accepted.'
      : integerFailureMessage(reason);
  return (
    <IntegerInput
      adapter={integerAdapter}
      id={id}
      ariaLabel={ariaLabel ?? t('milliseconds')}
      failureMessage={failureMessage}
      savedValue={savedMs}
      suffix="ms"
    />
  );
};
