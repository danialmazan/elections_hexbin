import { expect, test } from '@playwright/test'

test('restores deep links, selects a province, and retains it across elections', async ({ page }) => {
  await page.goto('?election=2023-07-23&province=28&lang=en')
  await expect(page.getByRole('heading', { name: 'Madrid', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Community of Madrid' })).not.toBeVisible()
  await page.getByRole('button', { name: 'Autonomous community' }).click()
  await expect(page.getByRole('heading', { name: 'Community of Madrid' })).toBeVisible()
  await page.getByRole('button', { name: 'Province', exact: true }).click()
  await page.getByLabel('Election', { exact: true }).selectOption('2019-11-10')
  await expect(page).toHaveURL(/election=2019-11-10.*province=28/)
  await page.keyboard.press('Escape')
  await expect(page.getByText('National result')).toBeVisible()
})

test('province focus is integrated into the map and boundary levels remain distinct', async ({ page }) => {
  await page.goto('?election=2023-07-23&lang=en')
  await page.getByRole('button', { name: 'Madrid, Select' }).click()
  const styles = await page.evaluate(() => ({
    provinceFocus: getComputedStyle(document.activeElement as Element).outlineStyle,
    cell: getComputedStyle(document.querySelector('.cell')!).strokeWidth,
    province: getComputedStyle(document.querySelector('.province-boundary')!).strokeWidth,
    region: getComputedStyle(document.querySelector('.region-boundary')!).strokeWidth,
    nation: getComputedStyle(document.querySelector('.national-boundary')!).strokeWidth,
  }))
  expect(styles.provinceFocus).toBe('none')
  expect(styles).toMatchObject({ cell: '0.55px', province: '1.9px', region: '3.4px', nation: '4.8px' })
})

test('mobile document has no horizontal overflow', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile')
  await page.goto('?lang=es')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  await expect(page.getByText('Partidos con representación')).toBeVisible()
})

test('every historical deep link loads only its selected election payload', async ({ page }) => {
  const ids = ['2023-07-23', '2019-11-10', '2019-04-28', '2016-06-26', '2015-12-20', '2011-11-20', '2008-03-09', '2004-03-14', '2000-03-12', '1996-03-03', '1993-06-06', '1989-10-29', '1986-06-22', '1982-10-28', '1979-03-01', '1977-06-15']
  for (const id of ids) {
    const requested: string[] = []
    const listener = (request: { url: () => string }) => { if (request.url().includes('/data/elections/')) requested.push(request.url()) }
    page.on('request', listener)
    await page.goto(`?election=${id}&lang=en`)
    await expect(page.getByLabel('Election', { exact: true })).toHaveValue(id)
    await expect(page.getByText('National result')).toBeVisible()
    expect(requested).toHaveLength(1)
    expect(requested[0]).toContain(`${id}.json`)
    page.off('request', listener)
  }
})
