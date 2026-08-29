import { expect, test } from '@playwright/test'

test('restores deep links, selects a province, and retains it across elections', async ({ page }) => {
  await page.goto('?election=2023-07-23&province=28&lang=en')
  await expect(page.getByRole('heading', { name: 'Madrid', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Community of Madrid' })).not.toBeVisible()
  await page.getByRole('button', { name: 'Autonomous community' }).click()
  await expect(page.getByRole('heading', { name: 'Community of Madrid' })).toBeVisible()
  await page.getByRole('button', { name: 'Province', exact: true }).click()
  await page.getByRole('button', { name: '10 November 2019' }).click()
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
