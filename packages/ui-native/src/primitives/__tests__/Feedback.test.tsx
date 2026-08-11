/** `Skeleton`, `Spinner` and `Divider` — the three that carry state without carrying input. */
import { screen } from '@testing-library/react-native';

import { Divider } from '../Divider';
import { Skeleton } from '../Skeleton';
import { Spinner } from '../Spinner';
import { getHidden, renderThemed, styleOf, themes } from './harness';

describe('Skeleton', () => {
  it('is hidden from the accessibility tree — the region announces, not the blocks', () => {
    renderThemed(<Skeleton variant="text" lines={3} />);
    expect(getHidden('Skeleton').props.accessibilityElementsHidden).toBe(true);
  });

  it('matches real geometry and always reserves the halal seal slot on a card', () => {
    renderThemed(<Skeleton variant="card" />);
    const card = getHidden('Skeleton');
    // hero, seal slot, title, two metadata lines — a card that reflows when the badge
    // arrives makes the badge feel like an afterthought.
    expect(card.children.length).toBe(5);
  });

  it('drops the seal slot only when explicitly told to', () => {
    renderThemed(<Skeleton variant="card" reserveSealSlot={false} />);
    expect(getHidden('Skeleton').children.length).toBe(4);
  });
});

describe('Spinner', () => {
  it('is a labelled, polite progress indicator when it stands alone', () => {
    renderThemed(<Spinner label="Loading restaurants" />);
    const spinner = screen.getByTestId('Spinner');
    expect(spinner.props.accessibilityRole).toBe('progressbar');
    expect(spinner.props.accessibilityLabel).toBe('Loading restaurants');
    expect(spinner.props.accessibilityState.busy).toBe(true);
  });

  it('is silent when it sits inside a control that already has a name', () => {
    renderThemed(<Spinner />);
    expect(getHidden('Spinner').props.accessibilityElementsHidden).toBe(true);
  });
});

describe('Divider', () => {
  it('is decorative and hidden by default', () => {
    renderThemed(<Divider />);
    const rule = getHidden('Divider');
    expect(rule.props.accessibilityElementsHidden).toBe(true);
    expect(styleOf(rule).backgroundColor).toBe(themes.customer.light.color.border.decorative);
  });

  it('becomes a named separator when it carries a label', () => {
    renderThemed(<Divider label="Today" />);
    const rule = screen.getByTestId('Divider');
    expect(rule.props.accessibilityLabel).toBe('Today');
    expect(screen.getByText('Today')).toBeTruthy();
  });

  it('insets from the leading edge with logical properties, never left/right', () => {
    renderThemed(<Divider inset />);
    const style = styleOf(getHidden('Divider'));
    expect(style.marginStart).toBe(themes.customer.light.density.gutter);
    expect(style.marginLeft).toBeUndefined();
  });
});
